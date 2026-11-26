// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployCore} from "../script/DeployCore.s.sol";
import {TestnetAgentID} from "../script/DeployTestnetAgentID.s.sol";

/// The chain guards of the release scripts. The broadcasts themselves run on testnet in the
/// Task 12 rehearsal, signed by the founder's encrypted deployer keystore.
contract DeployTest is Test {
    DeployCore internal script;

    function setUp() public {
        script = new DeployCore();
    }

    function test_deployCore_mainnetUsesTheRealAgentId() public view {
        assertEq(script.agentIdFor(56), 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);
        assertEq(script.outputFor(56), "../shared/abi/addresses.bsc.json");
    }

    function test_deployCore_testnetNeedsAgentIdFromEnv() public {
        vm.setEnv("AGENT_ID", "0x0000000000000000000000000000000000000000");
        vm.expectRevert(DeployCore.MissingAgentId.selector);
        script.agentIdFor(97);
        vm.setEnv("AGENT_ID", "0x00000000000000000000000000000000000000aa");
        assertEq(script.agentIdFor(97), address(0xaa));
        assertEq(script.outputFor(97), "../shared/abi/addresses.bsc-testnet.json");
    }

    function test_deployCore_otherChains_revert() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(DeployCore.UnsupportedChain.selector, 1));
        script.run();
        vm.expectRevert(abi.encodeWithSelector(DeployCore.UnsupportedChain.selector, 31337));
        script.agentIdFor(31337);
    }

    function test_testnetAgentId_refusesEveryChainButTestnet() public {
        vm.chainId(56);
        vm.expectRevert(abi.encodeWithSelector(TestnetAgentID.TestnetOnly.selector, 56));
        new TestnetAgentID();
        vm.chainId(97);
        new TestnetAgentID();
    }
}
