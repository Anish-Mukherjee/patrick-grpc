import { AddressLookupTableAccount, Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { fetchTokenAccountsData } from "./fetchTokenAccountsData";
import axios, { AxiosError } from "axios";
import { API_URLS } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import { estimateComputeUnits } from "./estimateComputeUnits";
import { sendNozomiTx } from "./send-nozomi-tx";
import { config } from "../../config";
import promiseRetry from 'promise-retry'

export type SwapRes = {
    tx: VersionedTransaction,
    tradeDirection: "BUY" | "SELL",
    inputTokenAmount: number,
    inputTokenMint: string,
    outputTokenAmount: number,
    outputTokenAmountSlippageAdjusted: number,
    outputTokenMint: string,
    priorityFee: number,
    platformFee: number,
}

export interface SwapCompute {
    id: string
    success: true
    version: 'V0' | 'V1'
    openTime?: undefined
    msg: undefined
    data: {
        swapType: 'BaseIn' | 'BaseOut'
        inputMint: string
        inputAmount: string
        outputMint: string
        outputAmount: string
        otherAmountThreshold: string
        slippageBps: number
        priceImpactPct: number
        routePlan: {
            poolId: string
            inputMint: string
            outputMint: string
            feeMint: string
            feeRate: number
            feeAmount: string
        }[]
    }
}

// Define interface for the swap transaction response
interface SwapTransactionResponse {
    id: string;
    version: string;
    success: boolean;
    data: { transaction: string }[];
    msg?: string;
}

const connection = new Connection(config.rpcUrl)

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000, // Start with 1 second delay
    maxDelay: 5000   // Maximum delay of 5 seconds
};

// Helper function to implement exponential backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to get backoff delay
const getBackoffDelay = (retryCount: number): number => {
    const delay = Math.min(
        RETRY_CONFIG.maxDelay,
        RETRY_CONFIG.baseDelay * Math.pow(2, retryCount)
    );
    return delay + (Math.random() * 1000); // Add jitter
};

// Helper function to handle the swap transaction request with retries
async function getSwapTransaction(
    params: {
        computeUnitPriceMicroLamports: string;
        swapResponse: SwapCompute;
        txVersion: string;
        wallet: string;
        wrapSol: boolean;
        unwrapSol: boolean;
        inputAccount?: string;
        outputAccount?: string;
    }
): Promise<SwapTransactionResponse> {
    let lastError: Error | null = null;

    for (let retry = 0; retry < RETRY_CONFIG.maxRetries; retry++) {
        try {
            const { data } = await axios.post<SwapTransactionResponse>(
                `${API_URLS.SWAP_HOST}/transaction/swap-base-in`,
                params
            );

            if (!data.success) {
                throw new Error(data.msg || 'Swap transaction request failed');
            }

            return data;
        } catch (error) {
            lastError = error as Error;
            console.log(`Attempt ${retry + 1} failed:`, error);

            if (retry < RETRY_CONFIG.maxRetries - 1) {
                const delay = getBackoffDelay(retry);
                console.log(`Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error('All retry attempts failed');
}

export const buildAndSubmitRaydiumTx = async (params: any) => {
    try {
        let { from, to, fromAmount, slippage, payer, priorityFee, decimals, autoPrioFees, autoPrioFeesLevel, maxPriorityFee } = params;
        console.log(params)
        const [isInputSol, isOutputSol] = [from === NATIVE_MINT.toBase58(), to === NATIVE_MINT.toBase58()];

        const { tokenAccounts } = await fetchTokenAccountsData(new PublicKey(payer));
        const inputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === from)?.publicKey;
        const outputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === to)?.publicKey;

        // Get swap compute response
        const { data: swapResponse } = await axios.get<SwapCompute>(
            `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${from}&outputMint=${to}&amount=${Math.floor(fromAmount!)}&slippageBps=${slippage * 100}&txVersion=V0`
        );
        console.log("Raydium Swap Quote response")
        console.log(swapResponse)

        // Get priority fee data
        const { data: feeData } = await axios.get<{
            id: string;
            success: boolean;
            data: { default: { vh: number; h: number; m: number } };
        }>(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);

        // Calculate compute unit price
        let computeUnitPriceMicroLamports;
        if (autoPrioFees) {
            computeUnitPriceMicroLamports = feeData.data.default[autoPrioFeesLevel as 'm' | 'h' | 'vh'];
        } else {
            const priorityFeeinMicroLamports = (priorityFee!) * 1e9 * 1e3;
            computeUnitPriceMicroLamports = Math.floor(priorityFeeinMicroLamports / 40_000);
        }

        // Get swap transaction with retry logic
        let swapTransactions = await getSwapTransaction({
            computeUnitPriceMicroLamports: String(computeUnitPriceMicroLamports),
            swapResponse,
            txVersion: 'V0',
            wallet: payer,
            wrapSol: isInputSol,
            unwrapSol: isOutputSol,
            inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
            outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58(),
        });

        const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
        const allTransactions = allTxBuf.map((txBuf) => VersionedTransaction.deserialize(txBuf));
        let tx = allTransactions[0];
        let maxComputeUnitPrice
        // if maxPriorityFee is provided, check that we are not exceeding it ( only if auto prio fees is enabled)
        if (autoPrioFees && maxPriorityFee) {
            const estimatedUnits = await estimateComputeUnits(tx, payer)
            maxComputeUnitPrice = Math.floor(maxPriorityFee / estimatedUnits)
            console.log('Max compute unit price:', maxComputeUnitPrice)
            if (computeUnitPriceMicroLamports > maxComputeUnitPrice) {
                swapTransactions = await getSwapTransaction({
                    computeUnitPriceMicroLamports: String(maxComputeUnitPrice),
                    swapResponse,
                    txVersion: 'V0',
                    wallet: payer,
                    wrapSol: isInputSol,
                    unwrapSol: isOutputSol,
                    inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
                    outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58(),
                });
                const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
                const allTransactions = allTxBuf.map((txBuf) => VersionedTransaction.deserialize(txBuf));
                tx = allTransactions[0];
            }
        }

        const addressLookupTableAccounts = await Promise.all(
            tx.message.addressTableLookups.map(async (lookup) => {
              return new AddressLookupTableAccount({
                key: lookup.accountKey,
                state: AddressLookupTableAccount.deserialize(
                  (await connection.getAccountInfo(lookup.accountKey))!.data
                ),
              });
            })
          );
          const swapMessage = TransactionMessage.decompile(tx.message, {
            addressLookupTableAccounts: addressLookupTableAccounts
          })

        const txid = await sendNozomiTx(swapMessage, config.defaultWallet, connection)

        const response = await promiseRetry(async (retry, number) => {
            console.log(`Attempt ${number}: Fetching transaction status...`);
            const response = await connection.getTransaction(txid, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
            });
            if (!response) {
                console.log(`Transaction not found. Retrying...`);
                retry(new Error('Transaction not found'));
            }
            console.log(`Transaction slot: ${response.slot}`)
            console.log(`Transaction response: ${JSON.stringify(response)}`);
            return response;
        }, {
            retries: 15,
            minTimeout: 2e3,
        });
        //console.timeEnd("Time taken to get transaction info");
        return response;

        const outputTokenAmount = parseFloat(swapResponse.data.outputAmount) / (isInputSol ? Math.pow(10, decimals) : LAMPORTS_PER_SOL)
        const inputTokenAmount = fromAmount! / (isInputSol ? LAMPORTS_PER_SOL : Math.pow(10, decimals))

        
        
    } catch (err) {
        console.log(`Error occurred while building tx for raydium swap:`, err);
        throw err; // Re-throw the error to handle it in the calling code
    }
};