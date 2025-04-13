import { Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, SimulateTransactionConfig, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { config } from "../../config";

const connection = new Connection(config.rpcUrl)

// Helper function to simulate transaction and get compute units
export const estimateComputeUnits = async(transaction: Transaction|VersionedTransaction, payer:PublicKey):Promise<number> =>{
    try {
        let simulation
        if (transaction instanceof Transaction){
            simulation = await connection.simulateTransaction(
            new VersionedTransaction(
                new TransactionMessage({
                    payerKey: payer,
                    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                    instructions: transaction.instructions
                }).compileToV0Message()
            )
        );
    } else {
        const config:SimulateTransactionConfig = {
            sigVerify:false,
            replaceRecentBlockhash:true,
            commitment:'processed'
        }
        simulation = await connection.simulateTransaction(transaction,config)
    }

        console.log("Simulated tx")
        console.log(simulation)

        // Get units consumed from simulation
        const unitsConsumed = simulation.value.unitsConsumed || 0;
        
        // Add a 20% buffer to the estimated units
        const estimatedUnits = Math.ceil(unitsConsumed * 1.2);
        
        // Cap at 1.4M (Solana's maximum compute units per transaction)
        return Math.min(estimatedUnits, 1_400_000);
    } catch (error) {
        console.error('Error estimating compute units:', error);
        // Return a safe default if estimation fails
        return 200_000;
    }
}