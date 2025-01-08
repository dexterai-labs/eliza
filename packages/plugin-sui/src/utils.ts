import { SuiClient } from "@mysten/sui/client";
import { elizaLogger } from "@elizaos/core";
import { IAgentRuntime } from "@elizaos/core";

// Constants
export const COIN_TYPES = {
    SUI: "0x2::sui::SUI",
    USDC: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::USDC",
    USDT: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::USDT",
} as const;

export const NETWORK_URLS = {
    MAINNET: "https://fullnode.mainnet.sui.io:443",
    TESTNET: "https://fullnode.testnet.sui.io:443",
    DEVNET: "https://fullnode.devnet.sui.io:443",
} as const;

// Account related utilities
export function parseAccount(runtime: IAgentRuntime): string {
    const account = runtime.getSetting("SUI_ACCOUNT");
    if (!account) {
        throw new Error("SUI_ACCOUNT not configured");
    }
    return account;
}

// Coin related utilities
export async function getCoinDecimals(
    suiClient: SuiClient,
    coinType: string
): Promise<number> {
    try {
        const metadata = await suiClient.getCoinMetadata({ coinType });
        if (!metadata) {
            throw new Error(`No metadata found for coin type: ${coinType}`);
        }
        return metadata.decimals;
    } catch (error) {
        elizaLogger.error(`Error fetching decimals for ${coinType}:`, error);
        // Default to SUI decimals (9) if metadata fetch fails
        return coinType === COIN_TYPES.SUI ? 9 : 6;
    }
}

// Amount related utilities
export function formatAmount(
    amount: bigint | number,
    decimals: number
): string {
    return (Number(amount) / Math.pow(10, decimals)).toString();
}

export function parseAmount(amount: string | number, decimals: number): bigint {
    return BigInt(Number(amount) * Math.pow(10, decimals));
}

// Address related utilities
export function isValidSuiAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function shortenAddress(address: string): string {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Network related utilities
export function getNetworkUrl(network: keyof typeof NETWORK_URLS): string {
    return NETWORK_URLS[network];
}

// Transaction related utilities
export function buildTransactionUrl(
    txHash: string,
    network: keyof typeof NETWORK_URLS = "MAINNET"
): string {
    const baseUrl =
        network === "MAINNET"
            ? "https://suiexplorer.com/txblock/"
            : `https://suiexplorer.com/${network.toLowerCase()}/txblock/`;
    return `${baseUrl}${txHash}`;
}

// Error handling utilities
export function handleSuiError(error: any): string {
    if (typeof error === "object" && error !== null) {
        if ("message" in error) return error.message;
        if ("code" in error) return `Error code: ${error.code}`;
    }
    return "Unknown error occurred";
}

// Validation utilities
export function validateCoinType(coinType: string): boolean {
    return Object.values(COIN_TYPES).includes(coinType as any);
}

// Type guards
export function isSuiTransactionResponse(response: any): boolean {
    return (
        response &&
        typeof response === "object" &&
        "digest" in response &&
        typeof response.digest === "string"
    );
}

// Helper functions
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
    fn: () => Promise<T>,
    attempts: number = 3,
    delay: number = 1000
): Promise<T> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === attempts - 1) throw error;
            await sleep(delay);
        }
    }
    throw new Error("Retry failed");
}
