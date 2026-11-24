// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// Forks BSC mainnet at a fixed block so every run reads the same state. Needs BSC_RPC_URL; without
/// it every fork test is skipped rather than failed, so `pnpm verify` never depends on the network.
/// Run them with `BSC_RPC_URL=<url> pnpm test:fork`.
abstract contract ForkBase is Test {
    /// A block from 24 November 2026. Moving it forward only needs the expectations rechecked.
    uint256 internal constant FORK_BLOCK = 135_458_000;

    address internal constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    /// Owner of the Agent ID contract at FORK_BLOCK; an EOA.
    address internal constant AGENT_ID_OWNER = 0x457C1fd14750c6c30886A2f2B57F1eF44B095882;

    function setUp() public virtual {
        string memory url = vm.envOr("BSC_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(url, FORK_BLOCK);
    }

    /// A real Agent ID holder from AGENT_ID_HOLDER, or zero when it is not set.
    function holderFromEnv() internal view returns (address) {
        return vm.envOr("AGENT_ID_HOLDER", address(0));
    }
}
