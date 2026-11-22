// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The one function Sealflare reads from the Agent ID contract.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}
