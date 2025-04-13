import { parseTokenAccountResp } from "@raydium-io/raydium-sdk-v2"
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token"
import { JsonWebKeyInput, KeyObject, PublicKeyInput } from "crypto"
import { Wallet } from "@coral-xyz/anchor"
import { Connection, PublicKey } from "@solana/web3.js"
import { config } from "../../config"

const connection = new Connection(config.rpcUrl)
export const fetchTokenAccountsData = async (publicKey:PublicKey) => {
    const solAccountResp = await connection.getAccountInfo(publicKey)
    const tokenAccountResp = await connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID })
    const token2022Req = await connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID })
    const tokenAccountData = parseTokenAccountResp({
        owner: publicKey,
        solAccountResp,
        tokenAccountResp: {
            context: tokenAccountResp.context,
            value: [...tokenAccountResp.value, ...token2022Req.value]
        }
    })
    return tokenAccountData
}