// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentID} from "../interfaces/IAgentID.sol";

/// @dev Local development only. Never deploy to a public network.
/// Stands in for the Agent ID contract; anyone can set any balance.
contract MockAgentID is IAgentID {
    error LocalChainOnly();

    mapping(address => uint256) public balanceOf;

    constructor() {
        if (block.chainid != 31337) revert LocalChainOnly();
    }

    function setBalance(address account, uint256 balance) external {
        balanceOf[account] = balance;
    }
}
