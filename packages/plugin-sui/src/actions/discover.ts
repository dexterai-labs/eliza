import {
    Action,
    ModelClass,
    composeContext,
    generateObject,
    Clients,
} from "@elizaos/core";
import { z } from "zod";
import { MongoClient } from "mongodb";

// Add MongoDB connection configuration
const MONGODB_URI =
    "mongodb+srv://raju:XaD02mpcMMLMrE0y@insidex-cluster-prod.99w3k.mongodb.net/?retryWrites=false&w=majority&appName=insidex-cluster-prod";
const DB_NAME = "advanced-scores";

// Define the schema for coin discovery parameters
const discoveryParamsSchema = z.object({
    minHqs: z.number().optional().nullable(),
    maxHqs: z.number().optional().nullable(),
    minMarketCap: z.number().optional().nullable(),
    maxMarketCap: z.number().optional().nullable(),
    minVolume: z.number().optional().nullable(),
    maxVolume: z.number().optional().nullable(),
    priceChange: z
        .enum(["increasing", "decreasing", "stable"])
        .optional()
        .nullable(),
    timeframe: z.enum(["24h", "7d", "30d"]).optional().nullable(),
    limit: z.number().min(1).max(50).default(10),
    sortBy: z.enum(["hqs", "volume", "marketCap"]).default("hqs"),
});

// Template for extracting discovery parameters from user messages
const discoveryTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "minHqs": 80,
    "maxHqs": null,
    "minMarketCap": 1000000,
    "maxMarketCap": null,
    "minVolume": 50000,
    "maxVolume": null,
    "priceChange": "increasing",
    "timeframe": "24h",
    "limit": 10,
    "sortBy": "hqs"
}
\`\`\`

Given the recent messages, extract the following information about coin discovery:
- Minimum and maximum HQS (Holder Quality Score)
- Minimum and maximum market cap
- Minimum and maximum volume
- Price trend (increasing/decreasing/stable)
- Timeframe for analysis
- Number of results to return
- Sorting criteria

Respond with a JSON markdown block containing only the extracted values.`;

function formatTwitterThread(results: any[]) {
    if (!results.length) {
        return ["No coins found matching your criteria."];
    }

    const threads: string[] = [];
    let currentThread = `🔍 Sui Coin Discovery Report\n\n`;

    results.forEach((coin, index) => {
        const coinTweet =
            `${index + 1}. ${coin.coin}\n` +
            `📊 HQS: ${coin.holderQualityScore.toFixed(2)}\n` +
            `💰 Vol(24h): $${coin.volumeMean.toFixed(2)}\n` +
            `💧 Liq Score: ${coin.liqScore.toFixed(2)}\n` +
            `👥 Users: ${coin.uniqueUsersMean}\n\n`;

        if ((currentThread + coinTweet).length > 280) {
            threads.push(currentThread);
            currentThread = coinTweet;
        } else {
            currentThread += coinTweet;
        }
    });

    if (currentThread) {
        threads.push(currentThread);
    }

    return threads;
}

const discoverCoins: Action = {
    name: "DISCOVER_COINS",
    similes: [
        "FIND_COINS",
        "SEARCH_COINS",
        "ANALYZE_COINS",
        "EXPLORE_COINS",
        "COIN_DISCOVERY",
    ],

    validate: async (runtime, message) => {
        console.log(
            "Validating coin discovery request from user:",
            message.userId
        );
        return true;
    },

    description:
        "Discover and analyze coins based on various metrics including HQS, market cap, volume, and price trends",

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
                modelClass: ModelClass.SMALL,
            });

            const query = buildMongoQuery(discoveryParams.object);
            const sortObject = buildSortQuery(discoveryParams.object.sort);

            const results = await scoresCollection
                .find(query)
                .sort(sortObject)
                .limit(discoveryParams.object.limit)
                .toArray();

            const response = {
                success: true,
                data: results.map((coin) => ({
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
                count: results.length,
                message: `Found ${results.length} coins matching your criteria.`,
            };

            // Post to Twitter if the client is available
            const twitterClient = new TwitterClient({
                bearerToken: process.env.TWITTER_BEARER_TOKEN,
                consumerKey: process.env.TWITTER_API_KEY,
                consumerSecret: process.env.TWITTER_API_SECRET,
                accessToken: process.env.TWITTER_ACCESS_TOKEN,
                accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
            });
            if (twitterClient) {
                try {
                    const tweetThreads = formatTwitterThread(results);
                    let parentTweetId: string | undefined;

                    for (const tweetContent of tweetThreads) {
                        if (!parentTweetId) {
                            const tweet =
                                await twitterClient.tweet(tweetContent);
                            parentTweetId = tweet.id;
                        } else {
                            await twitterClient.reply(
                                tweetContent,
                                parentTweetId
                            );
                        }
                    }

                    response.twitterThread = `https://twitter.com/user/status/${parentTweetId}`;
                } catch (twitterError) {
                    console.error("Error posting to Twitter:", twitterError);
                    response.twitterError = "Failed to post to Twitter";
                }
            }

            if (callback) {
                await callback(response);
            }

            return response;
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
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find coins with HQS above 80 and increasing price in the last 24 hours",
                    action: "DISCOVER_COINS",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "I found 5 coins matching your criteria:\n1. Coin A (HQS: 85, +15% 24h)\n2. Coin B (HQS: 82, +10% 24h)\n3. Coin C (HQS: 81, +8% 24h)\n...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Show me the top 10 coins by market cap with minimum volume of 50k",
                    action: "DISCOVER_COINS",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here are the top 10 coins by market cap with 50k+ volume:\n1. Coin X ($10M mcap, $100k vol)\n2. Coin Y ($8M mcap, $80k vol)\n...",
                },
            },
        ],
    ],
};

// Helper function to build MongoDB query from discovery parameters
function buildMongoQuery(params: z.infer<typeof discoveryParamsSchema>) {
    const query: any = {};

    // Only add filters if the values are not null/undefined
    if (params.minHqs != null || params.maxHqs != null) {
        query.holderQualityScore = {};
        if (params.minHqs != null)
            query.holderQualityScore.$gte = params.minHqs;
        if (params.maxHqs != null)
            query.holderQualityScore.$lte = params.maxHqs;
    }

    // Volume filter
    if (params.minVolume != null || params.maxVolume != null) {
        query.volumeMean = {};
        if (params.minVolume != null) query.volumeMean.$gte = params.minVolume;
        if (params.maxVolume != null) query.volumeMean.$lte = params.maxVolume;
    }

    return query;
}

// Helper function to format discovery results
function formatDiscoveryResults(results: any[]) {
    if (!results.length) {
        return "No coins found matching your criteria.";
    }

    const formattedResults = results
        .map((coin, index) => {
            return `${index + 1}. ${coin.coin}
    - HQS: ${coin.holderQualityScore.toFixed(2)}
    - Volume (24h): ${coin.volumeMean.toFixed(2)}
    - Liquidity Score: ${coin.liqScore.toFixed(2)}
    - Unique Users: ${coin.uniqueUsersMean}`;
        })
        .join("\n\n");

    return `Found ${results.length} coins matching your criteria:\n\n${formattedResults}`;
}

export default discoverCoins;
