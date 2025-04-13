import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage } from "@solana/web3.js";

// Define constants
const NOZOMI_TIP = new PublicKey("TEMPaMeCRFAS9EKF53Jd6KpHxgL47uWLcpFArU1Fanq");
const MIN_TIP_AMOUNT = 1_000_000;

export async function sendNozomiTx(
    msg: TransactionMessage,
    signer: Keypair,
    rpcClient: Connection
): Promise<string> {
    const ixs = msg.instructions
    // Create transfer instruction
    const tipIx = SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: NOZOMI_TIP,
        lamports: MIN_TIP_AMOUNT,
    });
    ixs.push(tipIx);

    // Get the latest blockhash
    const { blockhash } = await rpcClient.getLatestBlockhash();

    // Create transaction and sign it
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = blockhash;
    tx.feePayer = signer.publicKey;
    tx.sign(signer);

    // Send the transaction
    const signature = await rpcClient.sendTransaction(tx, [signer]);
    console.log("Transaction sent with signature:", signature);
    return signature
}