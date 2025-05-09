import Client, {
    CommitmentLevel,
    SubscribeRequestAccountsDataSlice,
    SubscribeRequestFilterAccounts,
    SubscribeRequestFilterBlocks,
    SubscribeRequestFilterBlocksMeta,
    SubscribeRequestFilterEntry,
    SubscribeRequestFilterSlots,
    SubscribeRequestFilterTransactions,
} from "@triton-one/yellowstone-grpc";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { TransactionFormatter } from "./utils/transaction-formatter"
import { RaydiumAmmParser } from "./utils/raydium-amm-parser";
import { SubscribeRequestPing } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import { config } from "../config";
import { buildAndSubmitRaydiumTx } from "./utils/build-raydium-swap";
import { SOLMint } from "@raydium-io/raydium-sdk-v2";

interface SubscribeRequest {
    accounts: { [key: string]: SubscribeRequestFilterAccounts };
    slots: { [key: string]: SubscribeRequestFilterSlots };
    transactions: { [key: string]: SubscribeRequestFilterTransactions };
    transactionsStatus: { [key: string]: SubscribeRequestFilterTransactions };
    blocks: { [key: string]: SubscribeRequestFilterBlocks };
    blocksMeta: { [key: string]: SubscribeRequestFilterBlocksMeta };
    entry: { [key: string]: SubscribeRequestFilterEntry };
    commitment?: CommitmentLevel | undefined;
    accountsDataSlice: SubscribeRequestAccountsDataSlice[];
    ping?: SubscribeRequestPing | undefined;
}

let count = 0

const TXN_FORMATTER = new TransactionFormatter();
const RAYDIUM_PARSER = new RaydiumAmmParser();
const RAYDIUM_PUBLIC_KEY = RaydiumAmmParser.PROGRAM_ID;

async function handleStream(client: Client, args: SubscribeRequest) {
    // Subscribe for events
    const stream = await client.subscribe();

    // Create `error` / `end` handler
    const streamClosed = new Promise<void>((resolve, reject) => {
        stream.on("error", (error) => {
            console.log("ERROR");
            reject(error);
            stream.end();
        });
        stream.on("end", () => {
            resolve();
        });
        stream.on("close", () => {
            resolve();
        });
    });

    // Handle updates
    stream.on("data", (data) => {
        if (data?.transaction) {
            const txn = TXN_FORMATTER.formTransactionFromJson(
                data.transaction,
                Date.now(),
            );
            const decodedRaydiumIxs = decodeRaydiumTxn(txn);

            if (!decodedRaydiumIxs?.length) return;
            const swapTransactionIx = decodedRaydiumIxs.find((decodedRaydiumIx) => {
                if (
                    decodedRaydiumIx.name === "swapIn" ||
                    decodedRaydiumIx.name === "swapOut"
                ) {
                    return decodedRaydiumIx;
                }
            });
            if (swapTransactionIx) {
                const info = getMintToken(data);
                const stringify: any = stringifyWithBigInt(swapTransactionIx.args);
                if (count < 1) {
                    console.log(
                        `Signature: ${txn.transaction.signatures[0]}
             CA : ${info.ca}
             Pool Info : ${stringify}
             Owner : ${info.signer}
             Slot: ${txn.slot}
            `
                    );

                    buildAndSubmitRaydiumTx({
                        from: 'So11111111111111111111111111111111111111112',
                        to: info.ca,
                        fromAmount: 1_000_000,
                        slippage: 30,
                        payer: config.defaultWallet.publicKey.toBase58(),
                        priorityFee: 0.0001,
                        autoPrioFees: false
                    })
                }
                count++
            }
        }
    });

    // Send subscribe request
    await new Promise<void>((resolve, reject) => {
        stream.write(args, (err: any) => {
            if (err === null || err === undefined) {
                resolve();
            } else {
                reject(err);
            }
        });
    }).catch((reason) => {
        console.error(reason);
        throw reason;
    });

    await streamClosed;
}
function stringifyWithBigInt(obj: any): string {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value);
}
async function subscribeCommand(client: Client, args: SubscribeRequest) {
    while (true) {
        try {
            await handleStream(client, args);
        } catch (error) {
            console.error("Stream error, restarting in 1 second...", error);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

const client = new Client(
    config.grpcEndpoint,
    config.grpcToken,
    undefined,
);

const req: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {
        raydiumLiquidityPoolV4: {
            vote: false,
            failed: false,
            signature: undefined,
            accountInclude: [], //input wallet
            accountExclude: [],
            accountRequired: [RAYDIUM_PUBLIC_KEY.toBase58()],
        },
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    commitment: CommitmentLevel.CONFIRMED,
};

subscribeCommand(client, req);

function decodeRaydiumTxn(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;

    const allIxs = TXN_FORMATTER.flattenTransactionResponse(tx);

    const raydiumIxs = allIxs.filter((ix) =>
        ix.programId.equals(RAYDIUM_PUBLIC_KEY),
    );

    const decodedIxs = raydiumIxs.map((ix) =>
        RAYDIUM_PARSER.parseInstruction(ix),
    );

    return decodedIxs;
}
function getMintToken(tx) {
    const data: any[] = tx.transaction.transaction.meta.preTokenBalances;
    const filter = data.filter((t) => t.mint !== "So11111111111111111111111111111111111111112")
    const ca = filter[0].mint;
    const signer = filter[0].owner;
    return {
        ca,
        signer
    };
}
function getMintTokenB(txn) {

}