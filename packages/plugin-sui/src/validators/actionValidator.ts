import { Memory } from "@elizaos/core";

interface ValidationResult {
    isValid: boolean;
    confidence: number;
    action: string;
}

const ACTION_KEYWORDS = {
    TRANSFER: ["send", "transfer", "pay", "give"],
    SWAP_TOKEN: ["swap", "sell", "buy", "convert", "exchange"],
    DISCOVER_COINS: ["find", "discover", "search", "list", "show"],
};

export function validateAction(
    message: Memory,
    expectedAction: string
): ValidationResult {
    const text = (message.content?.text || "").toLowerCase();

    const keywords = ACTION_KEYWORDS[expectedAction] || [];
    const isValid = keywords.some((keyword) => text.includes(keyword));
    console.log(`Validating action: ${expectedAction}, isValid: ${isValid}`);
    return {
        isValid,
        confidence: isValid ? 1 : 0,
        action: expectedAction,
    };
}
