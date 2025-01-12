import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    composeContext,
    elizaLogger,
    generateObject,
    type Action,
} from "@elizaos/core";
import { z } from "zod";

import { SuiClient } from "@mysten/sui/client";
import { Aftermath } from "aftermath-ts-sdk";

import { getCoinDecimals, NETWORK_URLS, getTokenDetails } from "../utils";

export interface SwapContent extends Content {
    recipient: string;
    amount: string | number;
    fromCoinType: string;
    toCoinType: string;
}

function isSwapContent(content: Content): content is SwapContent {
    console.log("Content for swap", content);
    return (
        typeof content.recipient === "string" &&
        typeof content.fromCoinType === "string" &&
        typeof content.toCoinType === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

const swapTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "0xaa000b3651bd1e57554ebd7308ca70df7c8c0e8e09d67123cc15c8a8a79342b3",
    "amount": "1",
    "fromCoinType": "0x2::sui::SUI",
    "toCoinType": "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token swap:
- Recipient wallet address to receive swapped tokens
- Amount of tokens to swap
- Source token type to swap from
- Destination token type to swap to

Respond with a JSON markdown block containing only the extracted values.`;

async function processSwapContent(content: SwapContent): Promise<SwapContent> {
    // Process fromCoinType
    let fromType = content.fromCoinType.toLowerCase();
    if (fromType === "sui") {
        content.fromCoinType = "0x2::sui::SUI";
    } else {
        content.fromCoinType = await getTokenDetails(fromType);
    }

    // Process toCoinType
    let toType = content.toCoinType.toLowerCase();
    if (toType === "sui") {
        content.toCoinType = "0x2::sui::SUI";
    } else {
        content.toCoinType = await getTokenDetails(toType);
    }

    return content;
}

export default {
    name: "SWAP_TOKEN",
    similes: ["SWAP_TOKEN", "SWAP_TOKENS", "SWAP_SUI", "SWAP"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating sui swap from user:", message.userId);

        return true;
    },
    description: "Swap tokens from the agent's wallet to another address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SWAP_TOKEN handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Define the schema for the expected output
        const swapSchema = z.object({
            recipient: z.string(),
            amount: z.union([z.string(), z.number()]),
            fromCoinType: z.string(),
            toCoinType: z.string(),
        });

        // Compose swap context
        const swapContext = composeContext({
            state,
            template: swapTemplate,
        });

        // Generate swap content with the schema
        const content = await generateObject({
            runtime,
            context: swapContext,
            schema: swapSchema,
            modelClass: ModelClass.SMALL,
        });

        let swapContent = content.object as SwapContent;

        // Add content processing step
        try {
            swapContent = await processSwapContent(swapContent);
        } catch (error) {
            console.error("Error processing swap content:", error);
            if (callback) {
                callback({
                    text: `Error processing token types: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }

        // Validate swap content
        if (!isSwapContent(swapContent)) {
            console.error("Invalid content for SWAP_TOKEN action.");
            if (callback) {
                callback({
                    text: "Unable to process swap request. Invalid content provided.",
                    content: { error: "Invalid swap content" },
                });
            }
            return false;
        }

        try {
            const router = new Aftermath("MAINNET").Router();

            let client = new SuiClient({ url: NETWORK_URLS.MAINNET });
            const decimals = await getCoinDecimals(
                client,
                swapContent.fromCoinType
            );
            const amountBigInt =
                BigInt(swapContent.amount) * BigInt(Math.pow(10, decimals));

            console.log(
                `Swapping: ${swapContent.amount} ${swapContent.fromCoinType} to ${swapContent.toCoinType} (${amountBigInt} base units)`
            );
            const route = await router.getCompleteTradeRouteGivenAmountIn({
                coinInType: swapContent.fromCoinType,
                coinOutType: swapContent.toCoinType,
                coinInAmount: amountBigInt,
            });
            console.log("Route:", route);
            const tx = await router.getTransactionForCompleteTradeRoute({
                walletAddress: swapContent.recipient,
                completeRoute: route,
                slippage: 0.01, // 1% max slippage
            });
            console.log("Transaction:", tx);

            if (callback) {
                callback({
                    text: `LFG! Swap transaction ready to send it ser, sign with your wallet and watch the magic happen!`,
                    content: {
                        txn: tx,
                        recipient: swapContent.recipient,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during token swap:", error);
            if (callback) {
                callback({
                    text: `Error swapping tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Swap 1 SUI(0x2::sui::SUI) to DEEP(0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP) to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Swap 1 SUI(0x2::sui::SUI) to DEEP(0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP) to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0",
                    action: "SWAP_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Successfully swapped 1 SUI to DEEP to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0, Transaction: 0x39a8c432d9bdad993a33cc1faf2e9b58fb7dd940c0425f1d6db3997e4b4b05c0",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
