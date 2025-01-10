import { Plugin } from "@elizaos/core";
import { transfer } from "./actions/transfer";
import discoverCoins from "./actions/discover";
import { WalletProvider } from "./providers/wallet";
import { executeSwap } from "./actions/swap";
import { queryHandlerAction } from "./actions/queryHandler";

export { WalletProvider };
export { transfer as TransferSuiToken };

export const suiPlugin: Plugin = {
    name: "sui",
    description: "Sui Plugin for Eliza",
    actions: [
        // executeSwap,
        // transfer,
        discoverCoins,
        // queryHandlerAction,
        queryHandlerAction,
    ],
    evaluators: [],
    providers: [],
};

export default suiPlugin;
