// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Core} from "../../src/Core.sol";
import {IAgentID} from "../../src/interfaces/IAgentID.sol";
import {ICore} from "../../src/interfaces/ICore.sol";
import {TargetType, Verdict} from "../../src/interfaces/Types.sol";
import {BytecodeScan} from "../../src/lib/BytecodeScan.sol";
import {ForkBase} from "./ForkBase.sol";

interface IERC721Transfer {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// The real SPACE ID Agent ID contract, which Core depends on for good through balanceOf.
/// Tests that need a real holder read AGENT_ID_HOLDER (and AGENT_ID_TOKEN for the transfer
/// check) and are skipped when those are not set.
contract AgentIdForkTest is ForkBase {
    /// BSC-USD, used as an attestation target with real code.
    address internal constant SAMPLE_TARGET = 0x55d398326f99059fF775485246999027B3197955;

    function test_fork_agentIdHasCode() public view {
        assertGt(AGENT_ID.code.length, 0);
        assertEq(
            vm.load(AGENT_ID, bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)),
            bytes32(0),
            "not an EIP-1967 proxy"
        );
    }

    function test_fork_balanceOfDoesNotRevertForArbitraryAddresses() public view {
        address[4] memory accounts =
            [address(0xdEaD), address(this), AGENT_ID_OWNER, address(uint160(uint256(keccak256("random"))))];
        for (uint256 i = 0; i < accounts.length; ++i) {
            IAgentID(AGENT_ID).balanceOf(accounts[i]);
        }
    }

    function test_fork_knownHolderHasBalance() public {
        address h = holderFromEnv();
        if (h == address(0)) vm.skip(true);
        assertGt(IAgentID(AGENT_ID).balanceOf(h), 0);
    }

    function test_fork_holderCanAttest_nonHolderCannot() public {
        address h = holderFromEnv();
        if (h == address(0)) vm.skip(true);
        Core core = new Core(AGENT_ID);
        bytes32 word = bytes32(uint256(uint160(SAMPLE_TARGET)));

        vm.prank(address(0xdEaD));
        vm.expectRevert(ICore.NotAgentIdHolder.selector);
        core.attest(TargetType.SMART_CONTRACT, word, Verdict.SAFE, 0, bytes32(0), "", "");

        vm.prank(h);
        bytes32 id = core.attest(TargetType.SMART_CONTRACT, word, Verdict.SAFE, 0, bytes32(0), "", "");
        assertEq(core.getAttestation(id, 0).guardian, h);
    }

    /// Records whether the Agent ID bytecode holds a reachable DELEGATECALL. At FORK_BLOCK it does
    /// not; a change here means the contract behind the address is not what was reviewed.
    function test_fork_agentIdBytecodeProbe() public {
        bool flagged = BytecodeScan.hasDelegatecall(AGENT_ID.code);
        emit log_named_string("Agent ID DELEGATECALL", flagged ? "found" : "none");
        assertFalse(flagged);
    }

    /// Architecture 12.5 assumes Agent ID is non-transferable. With a real holder and one of its
    /// token ids, a transfer to another address must revert; if it succeeds, one Agent ID could
    /// be passed around to act as many jurors (review finding R3).
    function test_fork_agentIdIsNotTransferable() public {
        address h = holderFromEnv();
        uint256 tokenId = vm.envOr("AGENT_ID_TOKEN", uint256(0));
        if (h == address(0) || tokenId == 0) vm.skip(true);
        assertEq(IERC721Transfer(AGENT_ID).ownerOf(tokenId), h);
        vm.prank(h);
        vm.expectRevert();
        IERC721Transfer(AGENT_ID).transferFrom(h, address(0xBEEF), tokenId);
    }
}
