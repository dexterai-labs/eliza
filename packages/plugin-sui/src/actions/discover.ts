import {
    Action,
    ModelClass,
    composeContext,
    generateObject,
    Clients,
    IAgentRuntime,
    Memory,
} from "@elizaos/core";
import { z } from "zod";
import { MongoClient } from "mongodb";
import { validateAction } from "../validators/actionValidator";

// Add MongoDB connection configuration
const MONGODB_URI =
    "mongodb+srv://raju:XaD02mpcMMLMrE0y@insidex-cluster-prod.99w3k.mongodb.net/?retryWrites=false&w=majority&appName=insidex-cluster-prod";
const DB_NAME = "advanced-scores";

// Simplified schema focusing only on sorting
const discoveryParamsSchema = z.object({
    sortBy: z
        .enum([
            "holderQualityScore",
            "volumeMean",
            "liqMean",
            "uniqueUsersMean",
            "averageAgeOfHolders",
        ])
        .default("holderQualityScore"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
    limit: z.number().min(1).max(10).default(5),
});

const discoveryTemplate = `Analyze the user's message to determine sorting metrics and direction. Map the intent as follows:

1. Volume-Related Metrics (volumeMean):
   - High: "most traded", "highest volume", "active trading", "busy", "hot"
   - Low: "least traded", "lowest volume", "quiet", "under the radar"

2. Liquidity Metrics (liqMean):
   - High: "most liquid", "easily tradeable", "high liquidity", "deep markets"
   - Low: "illiquid", "least liquid", "thin markets"

3. Holder Quality (holderQualityScore):
   - High: "best quality", "strongest holders", "diamond hands", "high conviction"
   - Low: "weak holders", "paper hands", "low quality"

4. User Base (uniqueUsersMean):
   - High: "most popular", "widely held", "most holders", "community favorite"
   - Low: "niche coins", "exclusive", "fewer holders"

5. Holder Age (averageAgeOfHolders):
   - High: "oldest holders", "long-term holders", "mature base", "stable holders"
   - Low: "new holders", "fresh money", "recent adopters"

Direction is determined by:
- Ascending (asc): never
- Descending (desc): "highest", "most", "largest", "strongest", "top"

Example interpretations:
- "Show me the most traded coins" → { "sortBy": "volumeMean", "sortDirection": "desc" }
- "Which coins have diamond hand holders?" → { "sortBy": "holderQualityScore", "sortDirection": "desc" }
- "Which coins are community favorites?" → { "sortBy": "uniqueUsersMean", "sortDirection": "desc" }
- "Show me coins with deep markets" → { "sortBy": "liqMean", "sortDirection": "desc" }
- "Get top coins by volume" → { "sortBy": "volumeMean", "sortDirection": "desc" }
- "Get top coins by holder quality" → { "sortBy": "holderQualityScore", "sortDirection": "desc" }
- "Get top coins by liquidity" → { "sortBy": "liqMean", "sortDirection": "desc" }
- "Get top coins by unique users" → { "sortBy": "uniqueUsersMean", "sortDirection": "desc" }
- "Get top coins by holder age" → { "sortBy": "averageAgeOfHolders", "sortDirection": "desc" }

Additional keywords for top metrics:
- "top by [metric]"
- "best by [metric]"
- "highest by [metric]"
- "leading by [metric]"
- "ranked by [metric]"

Respond with a JSON markdown block:
\`\`\`json
{
    "sortBy": "holderQualityScore",
    "sortDirection": "desc",
    "limit": 10
}
\`\`\`
`;

export default {
    name: "DISCOVER_COINS",
    similes: [
        "FIND_COINS",
        "SEARCH_COINS",
        "ANALYZE_COINS",
        "EXPLORE_COINS",
        "COIN_DISCOVERY",
    ],

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },

    description:
        "Discover, find and analyze coins based on various metrics including HQS, market cap, volume, and price trends, tradring activity, and more",

    handler: async (runtime, message, state, _options, callback) => {
        console.log("Starting DISCOVER_COINS handler...");
        let mongoClient: MongoClient | null = null;

        try {
            // Connect to MongoDB
            mongoClient = await MongoClient.connect(MONGODB_URI);
            const db = mongoClient.db(DB_NAME);
            const scoresCollection = db.collection("scores");

            // Generate discovery parameters from user message
            const context = composeContext({
                state,
                template: discoveryTemplate,
            });

            const discoveryParams = await generateObject({
                runtime,
                context,
                schema: discoveryParamsSchema,
                modelClass: ModelClass.MEDIUM,
            });

            const query = buildDatabaseQuery(discoveryParams.object);
            console.log("MongoDB Query:", query);
            const results = await scoresCollection
                .find({}) // Empty filter to get all documents
                .sort(query.sort)
                .limit(query.limit)
                .toArray();

            const formattedResults = results
                .map((coin) =>
                    formatCoinDetails(coin, discoveryParams.object.sortBy)
                )
                .join("\n\n");

            const response = {
                content: results.map((coin) => ({
                    coin: coin.coin,
                    holderQualityScore: Number(
                        coin.holderQualityScore.toFixed(2)
                    ),
                    volume24h: Number(coin.volumeMean.toFixed(2)),
                    liquidityScore: Number(coin.liqScore.toFixed(2)),
                    uniqueUsers: coin.uniqueUsersMean,
                    holdersWithSuiNs: coin.holdersWithSuiNs,
                    averageAgeOfHolders: coin.averageAgeOfHolders,
                })),
                text: `📊 Found ${results.length} coins matching your criteria:\n\n${formattedResults}`,
            };

            if (callback) {
                await callback(response);
            }

            return true;
        } catch (error) {
            console.error("Error in coin discovery:", error);
            const errorResponse = {
                success: false,
                error: "Failed to fetch coin data",
                message:
                    "Sorry, I encountered an error while searching for coins. Please try again.",
            };

            if (callback) {
                await callback(errorResponse);
            }

            return errorResponse;
        } finally {
            if (mongoClient) {
                await mongoClient.close();
            }
        }

        return false;
    },

    examples: [
        // Quality Score examples
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Show me the highest quality coins",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_A\n• Holder Quality Score: 92.45\n• 24h Volume: 150000\n• Liquidity Score: 85.32\n• Unique Users: 2500\n• Holders with SUI Names: 450\n• Avg. Holder Age: 45 days\n\n🪙 COIN_B\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
        // Volume examples
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Which coins have the most active trading?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_X\n• Holder Quality Score: 75.21\n• 24h Volume: 890000\n• Liquidity Score: 92.15\n• Unique Users: 3200\n• Holders with SUI Names: 620\n• Avg. Holder Age: 30 days\n\n🪙 COIN_Y\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
        // Liquidity examples
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find coins with the best liquidity",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_M\n• Holder Quality Score: 82.31\n• 24h Volume: 250000\n• Liquidity Score: 95.67\n• Unique Users: 1800\n• Holders with SUI Names: 380\n• Avg. Holder Age: 28 days\n\n🪙 COIN_N\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
        // Unique Users examples
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Show me the most popular coins by user count",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_P\n• Holder Quality Score: 88.12\n• 24h Volume: 420000\n• Liquidity Score: 87.45\n• Unique Users: 5200\n• Holders with SUI Names: 890\n• Avg. Holder Age: 35 days\n\n🪙 COIN_Q\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
        // Holder Age examples
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Which coins have the most mature holder base?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_R\n• Holder Quality Score: 91.24\n• 24h Volume: 180000\n• Liquidity Score: 83.56\n• Unique Users: 2800\n• Holders with SUI Names: 520\n• Avg. Holder Age: 120 days\n\n🪙 COIN_S\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
        // Reverse sort example
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Show me coins with the lowest trading volume",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "📊 Found 10 coins matching your criteria:\n\n🪙 COIN_T\n• Holder Quality Score: 65.34\n• 24h Volume: 5000\n• Liquidity Score: 45.23\n• Unique Users: 500\n• Holders with SUI Names: 80\n• Avg. Holder Age: 15 days\n\n🪙 COIN_U\n...",
                    action: "DISCOVER_COINS",
                },
            },
        ],
    ],
};

// Updated query builder for simplified parameters
function buildDatabaseQuery(params: z.infer<typeof discoveryParamsSchema>) {
    return {
        sort: { [params.sortBy]: params.sortDirection === "desc" ? -1 : 1 },
        limit: params.limit,
    };
}

// Add new function
function formatCoinDetails(coin: any, sortBy: string): string {
    // Define the primary metric display format based on sortBy
    const getPrimaryMetric = () => {
        switch (sortBy) {
            case "holderQualityScore":
                return `🏆 HQS: ${Number(coin.holderQualityScore).toFixed(2)}`;
            case "volumeMean":
                return `📈 24h Volume: ${Number(coin.volumeMean).toFixed(2)}`;
            case "liqMean":
                return `💧 Liquidity: ${Number(coin.liqScore).toFixed(2)}`;
            case "uniqueUsersMean":
                return `👥 Users: ${coin.uniqueUsersMean}`;
            case "averageAgeOfHolders":
                return `⏳ Avg. Holder Age: ${coin.averageAgeOfHolders} days`;
            default:
                return `🏆 HQS: ${Number(coin.holderQualityScore).toFixed(2)}`;
        }
    };

    return `🪙 ${coin.coin} - ${getPrimaryMetric()}
Other Metrics:
  • HQS: ${Number(coin.holderQualityScore).toFixed(2)}
  • Vol: ${Number(coin.volumeMean).toFixed(2)}
  • Liq: ${Number(coin.liqScore).toFixed(2)}
  • Users: ${coin.uniqueUsersMean}
  • SuiNS Holders: ${coin.holdersWithSuiNs}
  • Age: ${coin.averageAgeOfHolders}d`;
}
