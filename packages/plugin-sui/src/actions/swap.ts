import {
    ActionExample,
    composeContext,
    generateObjectDeprecated,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
    elizaLogger,
} from "@elizaos/core";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
// import { Transaction } from "@mysten/sui/transactions";
import { walletProvider } from "../providers/wallet";
import { validateAction } from "../validators/actionValidator";
import { getCoinDecimals } from "../utils";
import aftermathSdk from "../sdk/aftermath";

async function swapToken(
    client: SuiClient,
    walletAddress: string,
    inputTokenType: string,
    outputTokenType: string,
    amount: number,
    slippageBps: number = 50
): Promise<// { tx: Transaction; route: any }
any> {
    try {
        const decimals = await getCoinDecimals(client, inputTokenType);
        const amountBigInt = BigInt(amount * Math.pow(10, decimals));

        elizaLogger.log("Fetching quote with params:", {
            inputToken: inputTokenType,
            outputToken: outputTokenType,
            amount: amount.toString(),
            slippageBps,
        });

        // Get quote from Aftermath
        const route = await aftermathSdk.fetchQuote(
            inputTokenType,
            outputTokenType,
            amountBigInt,
            false // Use standard fee
        );

        if (!route) {
            throw new Error("Failed to get quote from Aftermath");
        }

        // Get swap transaction
        const tx = await aftermathSdk.getSwapTxn(
            route,
            walletAddress,
            slippageBps / 10000 // Convert bps to decimal
        );

        return { tx, route };
    } catch (error) {
        elizaLogger.error("Error in swapToken:", error);
        throw error;
    }
}

const swapTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "inputTokenType": "0x2::sui::SUI",
    "outputTokenType": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::USDC",
    "amount": 1.5,
    "slippageBps": 50
}
\`\`\`

{{recentMessages}}

Given the recent messages and wallet information below:

{{walletInfo}}

Extract the following information about the requested token swap from the natural language input.
THIS IS A SWAP/EXCHANGE ACTION, NOT A SEND/TRANSFER ACTION.

Key phrases to identify a swap (not a transfer):
- "sell X to/for Y" (this means swap X for Y, not transfer X)
- "buy X with Y"
- "swap X for Y"
- "exchange X to Y"
- "convert X to Y"
- "trade X for Y"

Extract:
- Input token (the token being sold/swapped)
- Output token (the token being bought/received)
- Amount to swap
- Slippage tolerance if specified (default 50 bps)

Amount patterns to recognize:
- Specific numbers: "1.5", "10", "100"
- Words: "one", "two", "half"
- Special amounts: "all", "max"
- Suffixes: "k" (1k = 1000)

Examples of valid swap requests:
- "sell all my SUI to ETH" (This is a swap from SUI to ETH)
- "sell 10 SUI for USDC" (This is a swap from SUI to USDC)
- "swap 1.5 SUI for ETH"
- "buy 100 USDC with SUI"
- "convert all my SUI to ETH"
`;

// async function getTokensInWallet(runtime: IAgentRuntime) {
//     const address = await getWalletAddress(runtime);
//     const provider = new JsonRpcProvider();
//     const walletProvider = new WalletProvider(provider, address);

//     const walletInfo = await walletProvider.fetchPortfolioValue(runtime);
//     return walletInfo.items;
// }

export const executeSwap: Action = {
    name: "SWAP_TOKEN",
    similes: [
        "SWAP_TOKENS",
        "TOKEN_SWAP",
        "TRADE_TOKENS",
        "EXCHANGE_TOKENS",
        "SELL_TOKENS",
        "SELL_TOKEN",
        "SELL_FOR",
        "SELL_TO",
        "SELL",
        "BUY",
        "BUY_WITH",
        "BUY_FOR",
        "BUY_USING",
        "CONVERT_TO",
        "CONVERT_INTO",
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        const validation = validateAction(message, "SWAP_TOKEN");
        return validation.isValid;
    },
    description: "Perform a token swap on Sui network.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const walletInfo = await walletProvider.get(runtime, message, state);
        state.walletInfo = walletInfo;

        const swapContext = composeContext({
            state,
            template: swapTemplate,
        });

        const response = await generateObjectDeprecated({
            runtime,
            context: swapContext,
            modelClass: ModelClass.LARGE,
        });

        if (!response.inputTokenType || !response.outputTokenType) {
            const responseMsg = {
                text: "I need both input and output token types to perform the swap",
            };
            callback?.(responseMsg);
            return true;
        }

        if (!response.amount) {
            const responseMsg = {
                text: "I need the amount to perform the swap",
            };
            callback?.(responseMsg);
            return true;
        }

        console.log("response", response);

        try {
            // Create SuiClient with mainnet URL
            const client = new SuiClient({
                url: getFullnodeUrl("mainnet"),
            });
            const walletAddress = await getWalletAddress(runtime);

            const { tx, route } = await swapToken(
                client,
                walletAddress,
                response.inputTokenType,
                response.outputTokenType,
                response.amount,
                response.slippageBps || 50
            );

            if (callback) {
                callback({
                    text: `Prepared swap transaction from ${response.amount} ${response.inputTokenType} to ${response.outputTokenType}`,
                    content: {
                        success: true,
                        transaction: tx,
                        route: route,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during token swap:", error);
            const errorMsg = {
                text: `Failed to execute swap: ${error.message}`,
            };
            callback?.(errorMsg);
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: "swap 1.5 SUI for USDC",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swapping 1.5 SUI for USDC...",
                    action: "SWAP_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: "buy 100 USDC with SUI",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swapping SUI for 100 USDC...",
                    action: "SWAP_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: "sell all my SUI for USDC",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swapping all available SUI for USDC...",
                    action: "SWAP_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: "sell all my SUI to ETH",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Parsed swap request:\nInput Token: 0x2::sui::SUI\nOutput Token: <eth_token_type>\nAmount: all\nSlippage: 50 bps",
                    action: "SWAP_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: "sell 10 SUI for ETH",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Parsed swap request:\nInput Token: 0x2::sui::SUI\nOutput Token: <eth_token_type>\nAmount: 10\nSlippage: 50 bps",
                    action: "SWAP_TOKEN",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
