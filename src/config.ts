import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { Keypair } from '@solana/web3.js'
import dotenv from 'dotenv'
dotenv.config()

//const certificatePath = path.resolve(__dirname, '../certificates/certificate.crt');

interface IConfig {
    defaultCommitmentLevel:"confirmed"|"processed"|"finalized"
    botUserName:string,
    rpcUrl:string,
    grpcEndpoint: string,
    grpcToken: string
    solMint: "So11111111111111111111111111111111111111112",
    defaultWallet: Keypair
}

export const config: IConfig = {
    defaultCommitmentLevel:"processed",
    botUserName: process.env.BOT_NAME||"Killshot_sol_bot",
    rpcUrl:process.env.MAINNET_RPC_URL,
    grpcEndpoint: process.env.GRPC_ENDPOINT||"",
    grpcToken: process.env.GRPC_TOKEN||"",
    solMint:'So11111111111111111111111111111111111111112',
    defaultWallet: Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_WALLET_SK))
}