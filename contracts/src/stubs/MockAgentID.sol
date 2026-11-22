// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentID} from "../interfaces/IAgentID.sol";

/// @dev Local development only. Never deploy to a public network.
/// Stands in for the Agent ID contract; anyone can set any balance.
contract MockAgentID is IAgentID {
    mapping(address => uint256) public balanceOf;

    function setBalance(address account, uint256 balance) external {
        balanceOf[account] = balance;
    }
}
