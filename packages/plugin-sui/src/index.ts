import { Plugin } from "@elizaos/core";
import swapAction from "./actions/swap";
import { transfer } from "./actions/transfer";
import discoverCoinsAction from "./actions/discover";

export const suiPlugin: Plugin = {
    name: "sui",
    description: "Sui blockchain integration for DeFi operations",

    providers: [],

    actions: [
        swapAction, // Atomic swap action
        discoverCoinsAction,
        // transfer, // Atomic transfer action
    ],
};

export default suiPlugin;
