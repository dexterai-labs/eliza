import type { Router } from "aftermath-ts-sdk";
import { Aftermath } from "aftermath-ts-sdk";
// import {
//     Transaction,
//     TransactionObjectArgument,
// } from "@mysten/sui/transactions";
import { elizaLogger } from "@elizaos/core";

const SWAP_FEE_WALLET = "0x..."; // Add your fee wallet address here

class AftermathSdk {
    sdk: Aftermath;
    router: Router;

    constructor() {
        this.sdk = new Aftermath("MAINNET");
        this.router = this.sdk.Router();
        this.init();
    }

    async init() {
        await this.sdk.init();
    }

    fetchQuote = async (
        tokenIn: string,
        tokenOut: string,
        amount: bigint,
        isFee0?: boolean
    ) => {
        try {
            const route = await this.router.getCompleteTradeRouteGivenAmountIn({
                coinInType: tokenIn,
                coinOutType: tokenOut,
                coinInAmount: amount,
                referrer: SWAP_FEE_WALLET,
                externalFee: {
                    recipient: SWAP_FEE_WALLET,
                    feePercentage: isFee0 ? 0.0001 : 0.005, // 0.5% fee
                },
            });

            return route;
        } catch (err) {
            elizaLogger.error("Error fetching quote:", err);
            return null;
        }
    };

    getSwapTxn = async (route: any, address: string, slippage: number) => {
        const tx = await this.router.getTransactionForCompleteTradeRoute({
            walletAddress: address,
            completeRoute: route,
            slippage,
        });

        return tx;
    };

    //     getSwapTxnWithCoinOut = async (
    //         tx: Transaction,
    //         coinIn: TransactionObjectArgument,
    //         route: any,
    //         address: string,
    //         slippage: number
    //     ) => {
    //         const data = await this.router.addTransactionForCompleteTradeRoute({
    //             tx,
    //             coinInId: coinIn,
    //             walletAddress: address,
    //             completeRoute: route,
    //             slippage,
    //         });

    //         return {
    //             tx: data.tx,
    //             coinOut: data.coinOutId,
    //         };
    //     };
    // }
}

const aftermathSdk = new AftermathSdk();

export { AftermathSdk };
export default aftermathSdk;
