// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Core} from "../src/Core.sol";

/// Release step 1: deploys Core alone to BSC mainnet (56) or BSC testnet (97) and writes its
/// address to shared/abi/addresses.bsc.json (mainnet) or addresses.bsc-testnet.json (testnet).
///
/// Run with a hardware wallet, never a private key:
///   forge script DeployCore --root contracts --rpc-url $BSC_RPC_URL --ledger --sender <address> --broadcast --verify
/// On testnet set AGENT_ID to the TestnetAgentID address from DeployTestnetAgentID.
contract DeployCore is Script {
    uint256 internal constant BSC_MAINNET = 56;
    uint256 internal constant BSC_TESTNET = 97;
    /// SPACE ID Agent ID on BSC mainnet. Also in shared/rules/constants.ts as AGENT_ID_ADDRESS.
    address internal constant AGENT_ID_MAINNET = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    error UnsupportedChain(uint256 chainId);
    error MissingAgentId();

    function run() external returns (Core core) {
        address agentId = agentIdFor(block.chainid);
        vm.startBroadcast();
        core = new Core(agentId);
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "agentId", agentId);
        vm.serializeAddress(key, "deployer", core.deployer());
        vm.writeJson(vm.serializeAddress(key, "core", address(core)), outputFor(block.chainid));
    }

    function agentIdFor(uint256 chainId) public view returns (address agentId) {
        if (chainId == BSC_MAINNET) return AGENT_ID_MAINNET;
        if (chainId != BSC_TESTNET) revert UnsupportedChain(chainId);
        agentId = vm.envOr("AGENT_ID", address(0));
        if (agentId == address(0)) revert MissingAgentId();
    }

    function outputFor(uint256 chainId) public pure returns (string memory) {
        if (chainId == BSC_MAINNET) return "../shared/abi/addresses.bsc.json";
        if (chainId == BSC_TESTNET) return "../shared/abi/addresses.bsc-testnet.json";
        revert UnsupportedChain(chainId);
    }
}
