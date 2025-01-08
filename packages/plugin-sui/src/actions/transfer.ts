import {
    Action,
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
} from "@elizaos/core";
import { z } from "zod";
import { SuiClient } from "@mysten/sui/client";
// import { Transaction } from "@mysten/sui/transactions";
import { SUI_DECIMALS } from "@mysten/sui/utils";
import { walletProvider } from "../providers/wallet";
import { parseAccount } from "../utils";
import { validateAction } from "../validators/actionValidator";

// Define types for transfer content
interface TransferContent extends Content {
    recipient: string;
    amount: string | number;
    coinType: string;
}

// Define the transfer template
const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "0x123...456",
    "amount": 10,
    "coinType": "0x2::sui::SUI"
}
\`\`\`

Given the recent messages and wallet information below:
{{recentMessages}}
{{walletInfo}}

Extract the following information about the requested token transfer:
- Recipient address (can be 0x... format or @username)
- Amount to transfer
- Coin type (default to "0x2::sui::SUI" if not specified)

Common coin types:
- SUI: "0x2::sui::SUI"
- USDC: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::USDC"
- USDT: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::USDT"

Amount patterns to recognize:
- Specific numbers: "1.5", "10", "100"
- Words: "one", "two", "half"
- Special amounts: "all", "max"
- Suffixes: "k" (1k = 1000)

Examples of valid transfer requests:
- "send 10 SUI to 0x123...456"
- "transfer 5 USDC to @alice"
- "pay 2.5 USDT to 0x789...012"
- "send all my SUI to 0x345...678"

Examples that are NOT transfers (these would be swaps):
- "sell SUI for USDC" (no recipient address = swap)
- "convert SUI to ETH" (no recipient address = swap)
- "exchange SUI for USDC" (no recipient address = swap)
`;

// Define the transfer action
export const transfer: Action = {
    name: "TRANSFER",
    similes: [
        "SEND_TOKEN",
        "TRANSFER_TOKEN",
        "SEND_COINS",
        "TRANSFER_COINS",
        "SEND_FUNDS",
        "TRANSFER_FUNDS",
        "PAY",
    ],
    description:
        "Transfer tokens from the agent's wallet to another address with validation and error handling",

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        const validation = validateAction(message, "TRANSFER");
        return validation.isValid;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting TRANSFER handler...");

        try {
            const walletInfo = await walletProvider.get(
                runtime,
                message,
                state
            );
            state.walletInfo = walletInfo;

            if (!state) {
                state = await runtime.composeState(message);
            }
            state = await runtime.updateRecentMessageState(state);

            // Define transfer schema
            const transferSchema = z.object({
                recipient: z.string(),
                amount: z.union([z.string(), z.number()]),
                coinType: z.string().default("0x2::sui::SUI"),
            });

            const transferContext = composeContext({
                state,
                template: transferTemplate,
            });

            const content = await generateObject({
                runtime,
                context: transferContext,
                schema: transferSchema,
                modelClass: ModelClass.SMALL,
            });

            const transferContent = content.object as TransferContent;

            if (!transferContent.recipient || !transferContent.amount) {
                throw new Error("Missing required transfer parameters");
            }

            const suiAccount = parseAccount(runtime);
            const suiClient = new SuiClient({
                url: runtime.getSetting("SUI_FULLNODE_URL"),
            });

            const adjustedAmount = BigInt(
                Number(transferContent.amount) * Math.pow(10, SUI_DECIMALS)
            );

            // const tx = new Transaction();

            // // Create the transfer transaction
            // const [coin] = tx.splitCoins(tx.gas, [adjustedAmount]);
            // tx.transferObjects([coin], transferContent.recipient);

            if (callback) {
                // callback({
                //     text: `Prepared transfer of ${transferContent.amount} ${transferContent.coinType} to ${transferContent.recipient}`,
                //     content: {
                //         success: true,
                //         transaction: tx,
                //         amount: transferContent.amount,
                //         recipient: transferContent.recipient,
                //         coinType: transferContent.coinType,
                //     },
                // });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Transfer execution failed:", error);

            if (callback) {
                callback({
                    text: `Transfer failed: ${error.message}`,
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
                content: "send 10 SUI to 0x123...456",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Transferring 10 SUI to 0x123...456",
                    action: "TRANSFER",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: "transfer 5 USDC to @alice",
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Transferring 5 USDC to @alice's wallet",
                    action: "TRANSFER",
                },
            },
        ],
    ] as ActionExample[][],
};

export default transfer;
