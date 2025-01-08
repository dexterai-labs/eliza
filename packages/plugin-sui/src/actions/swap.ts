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
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { walletProvider } from "../providers/wallet";
import { validateAction } from "../validators/actionValidator";
import { getCoinDecimals, getTokenDetails } from "../utils";
import aftermathSdk from "../sdk/aftermath";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

async function swapToken(
    client: SuiClient,
    walletAddress: string,
    inputTokenType: string,
    outputTokenType: string,
    amount: number,
    slippageBps: number = 5000000
): Promise<{ tx: Transaction; route: any }> {
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
    "inputTokenType": "SUI",
    "outputTokenType": "USDC",
    "amount": 1.5,
    "slippageBps": 50,
    "amountScalingFactor": -1
}
\`\`\`

The amountScalingFactor should be determined by analyzing words that indicate portions:
- Words meaning "all" or "complete amount" (scaling factor: 1.0):
  • all, entire, complete, total, everything, max, maximum, whole

- Words meaning "half" (scaling factor: 0.5):
  • half, 50%, fifty percent, one-half, halfway

- Words meaning "third" (scaling factor: 0.333):
  • third, 33%, thirty-three percent, one-third, 1/3

- Words meaning "quarter" (scaling factor: 0.25):
  • quarter, 25%, twenty-five percent, one-fourth, fourth

- Specific numbers (scaling factor: -1):
  • Any numerical value (e.g., 1.5, 10, 100)
  • Numbers with k/m suffix (e.g., 1k = 1000)

Examples:
- "swap all my ETH to SUI" → {
    inputTokenType: "ETH",
    outputTokenType: "SUI",
    amountScalingFactor: 1.0
}
- "buy BTC from half of SUI I have" → {
    inputTokenType: "SUI",
    outputTokenType: "BTC",
    amountScalingFactor: 0.5
}
- "convert one third of my SUI to USDC" → {
    inputTokenType: "SUI",
    outputTokenType: "USDC",
    amountScalingFactor: 0.333
}

{{recentMessages}}

Given the recent messages and wallet information below:

{{walletInfo}}

Extract the following information about the requested token swap from the natural language input.
THIS IS A SWAP/EXCHANGE ACTION, NOT A SEND/TRANSFER ACTION.

Key phrases to identify a swap (not a transfer):
- "sell X to/for Y" (this means swap X for Y, not transfer X)
- "buy X with Y" or "buy X from Y"
- "swap X for Y" or "swap X to Y"
- "exchange X to Y"
- "convert X to Y"
- "trade X for Y"

Extract:
- Input token (the token being sold/swapped)
- Output token (the token being bought/received)
- Amount to swap (look for words indicating portions or specific numbers)
- Slippage tolerance if specified (default 50 bps)
- Amount scaling factor based on the word patterns above

Focus on understanding the intent of the amount description rather than matching exact phrases. Consider the context and natural language variations.`;

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
        const walletAddress =
            "0x3b2fb00f5cf3f4b948ee437e8d8a3d0db37f91cb0b94526e38b414a3881479ea";
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const swapContext = composeContext({
            state,
            template: swapTemplate,
        });

        const response = await generateObjectDeprecated({
            runtime,
            context: swapContext,
            modelClass: ModelClass.MEDIUM,
        });

        if (!response.inputTokenType || !response.outputTokenType) {
            const responseMsg = {
                text: "I need both input and output token types to perform the swap",
            };
            callback?.(responseMsg);
            return true;
        }

        const inputTokenDetails = await getTokenDetails(
            response.inputTokenType.toUpperCase() === "SUI"
                ? "0x2::sui::SUI"
                : response.inputTokenType
        );
        const outputTokenDetails = await getTokenDetails(
            response.outputTokenType.toUpperCase() === "SUI"
                ? "0x2::sui::SUI"
                : response.outputTokenType
        );
        response.inputTokenType = inputTokenDetails;
        response.outputTokenType = outputTokenDetails;

        try {
            const client = new SuiClient({
                url: "https://fullnode.mainnet.sui.io:443",
            });

            // Fetch balance and calculate amount if needed
            if (
                (!response.amount || response.amount === null) &&
                response.amountScalingFactor !== -1
            ) {
                const coinType =
                    response.inputTokenType.toUpperCase() === "SUI"
                        ? SUI_TYPE_ARG
                        : response.inputTokenType;
                const balance = await client.getBalance({
                    owner: walletAddress,
                    coinType,
                });

                // Calculate final amount based on scaling factor using BigInt
                const scaledBalance =
                    (BigInt(balance.totalBalance) *
                        BigInt(
                            Math.floor(response.amountScalingFactor * 1000000)
                        )) /
                    BigInt(1000000);
                response.amount = scaledBalance.toString();

                elizaLogger.log("Amount calculation from balance:", {
                    balance,
                    scalingFactor: response.amountScalingFactor,
                    calculatedAmount: response.amount,
                    tokenType: coinType,
                });

                if (response.amount <= 0) {
                    const errorMsg = {
                        text: `Insufficient balance (${balance} ${response.inputTokenType}) for the swap`,
                    };
                    callback?.(errorMsg);
                    return false;
                }
            }

            if (!response.amount || response.amount <= 0) {
                const errorMsg = {
                    text: "Invalid amount for swap. Please specify a valid amount.",
                };
                callback?.(errorMsg);
                return false;
            }

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
