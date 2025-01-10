import {
    Action,
    IAgentRuntime,
    Memory,
    elizaLogger,
    ModelClass,
    composeContext,
    generateObject,
    State,
    HandlerCallback,
} from "@elizaos/core";
import { z } from "zod";

const queryAnalysisTemplate = `Break down the user query into a series of blockchain operations. Return a JSON array of subtasks.

Example responses:
\`\`\`json
[
    {
        "type": "DISCOVER_COINS",
        "description": "Find top tokens by volume in last 24 hours",
        "priority": 1
    },
    {
        "type": "SWAP_TOKENS",
        "description": "Swap 10 SUI for the best performing token found",
        "priority": 2
    }
]
\`\`\`

Consider these operation types:

1. Token Discovery (type: "DISCOVER_COINS")
   - Looking for tokens
   - Market analysis
   - Token screening

2. Token Swaps (type: "SWAP_TOKENS")
   - Exchanging tokens
   - Buying/selling tokens

3. Token Transfers (type: "TRANSFER_TOKENS")
   - Sending tokens
   - Moving tokens between addresses


Break down the following query into subtasks:
{{recentMessages}}`;

// Define schema for subtasks - wrap in an object schema
const subtaskSchema = z.object({
    tasks: z.array(
        z.object({
            type: z.enum(["DISCOVER_COINS", "SWAP_TOKENS", "TRANSFER_TOKENS"]),
            priority: z.number(),
            description: z.string(),
        })
    ),
});

type SubTask = z.infer<typeof subtaskSchema>["tasks"][0];
type TaskResult = {
    type: SubTask["type"];
    result?: any;
    error?: string;
};

export const queryHandlerAction: Action = {
    name: "QUERY_HANDLER",
    similes: ["PROCESS_REQUEST", "HANDLE_QUERY"],
    description:
        "Analyzes and executes natural language queries for blockchain operations",

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        try {
            // Define template inside handler where runtime is available
            // Generate subtasks from user message
            const context = composeContext({
                state: state,
                template: queryAnalysisTemplate,
            });

            const analysisResult = await generateObject({
                runtime,
                context,
                schema: subtaskSchema,
                modelClass: ModelClass.MEDIUM,
            });

            const subtasks = analysisResult.object.tasks; // Access the tasks array
            elizaLogger.log("Identified subtasks:", subtasks);

            if (!subtasks?.length) {
                const errorResponse = {
                    success: false,
                    error: "No tasks identified",
                    message:
                        "No tasks were identified in your query. Please try being more specific about what you'd like to do.",
                };
                await callback?.(errorResponse);
                return errorResponse;
            }

            // Execute subtasks in priority order
            const results = [];
            let previousResult = null;

            for (const task of subtasks.sort(
                (a, b) => a.priority - b.priority
            )) {
                try {
                    const taskMessage: Memory = {
                        ...message,
                        content: {
                            ...message.content,
                            text: task.description,
                            previousResult,
                        },
                    };

                    const result = await runtime.processAction(
                        // by: [
                        //     {
                        //         name: task.type.toUpperCase(),
                        //         message: taskMessage,
                        //     },
                        // ],
                        // state,
                        "DISCOVER_COINS",
                        message
                    );

                    results.push({ type: task.type, result });
                    previousResult = result;

                    // Provide intermediate feedback
                    // await callback({
                    //     success: true,
                    //     data: { type: task.type, result },
                    //     message: `✅ Completed ${task.type}: ${task.description}`,
                    // });
                } catch (error) {
                    elizaLogger.error(`Error executing ${task.type}:`, error);
                    results.push({ type: task.type, error: error.message });
                    break;
                }
            }

            const resultSummary = results
                .map((result) => {
                    if (result.error) {
                        return `❌ ${result.type}: ${result.error}`;
                    }
                    return `✅ ${result.type}: Operation completed successfully`;
                })
                .join("\n");

            const response = {
                success: true,
                data: {
                    originalQuery: message.content.text,
                    executedTasks: results,
                    timestamp: new Date().toISOString(),
                },
                message: `I've processed your request:\n${resultSummary}`,
            };

            if (callback) {
                await callback(response);
            }

            return response;
        } catch (error) {
            elizaLogger.error("Error in query handler:", error);
            const errorResponse = {
                success: false,
                error: "Failed to process query",
                message:
                    "Sorry, I encountered an error while processing your request. Please try again.",
            };

            if (callback) {
                await callback(errorResponse);
            }

            return errorResponse;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find me the top tokens by volume and swap 10 tokens for the best performing one",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "I'll analyze and execute your request for token discovery and swapping",
                    action: "QUERY_HANDLER",
                },
            },
        ],
    ],
};
