// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";

/// Stands in for Agent ID during the BSC testnet rehearsal only. Anyone can grant a balance.
/// It refuses every chain but 97, so it can never be deployed next to the real Core on mainnet.
contract TestnetAgentID is IAgentID {
    uint256 internal constant BSC_TESTNET = 97;

    error TestnetOnly(uint256 chainId);

    mapping(address => uint256) public balanceOf;

    constructor() {
        if (block.chainid != BSC_TESTNET) revert TestnetOnly(block.chainid);
    }

    function setBalance(address account, uint256 balance) external {
        balanceOf[account] = balance;
    }
}

/// Deploys TestnetAgentID to BSC testnet:
///   forge script DeployTestnetAgentID --root contracts --rpc-url $BSC_TESTNET_RPC_URL --ledger --sender <address> --broadcast
contract DeployTestnetAgentID is Script {
    function run() external returns (TestnetAgentID agentId) {
        vm.startBroadcast();
        agentId = new TestnetAgentID();
        vm.stopBroadcast();
    }
}
