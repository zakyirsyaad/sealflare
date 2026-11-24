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
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
}

/// The real SPACE ID Agent ID contract, which Core depends on for good through balanceOf.
/// Tests that need a real holder read AGENT_ID_HOLDER (and AGENT_ID_TOKEN for the transfer
/// check) and are skipped when those are not set.
contract AgentIdForkTest is ForkBase {
    /// BSC-USD, used as an attestation target with real code.
    address internal constant SAMPLE_TARGET = 0x55d398326f99059fF775485246999027B3197955;
    /// The Agent ID contract's custom error for any transfer or approval: Soulbound().
    bytes4 internal constant SOULBOUND = 0xa4420a95;
    /// OpenZeppelin Ownable's OwnableUnauthorizedAccount(address).
    bytes4 internal constant OWNABLE_UNAUTHORIZED = 0x118cdaa7;
    /// Safe multisig named as pendingOwner at FORK_BLOCK.
    address internal constant PENDING_OWNER = 0x082b3370974E3DA99c6e3572A7FcBd2222f9a350;

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
    /// token ids, every transfer and approval path must revert with the contract's Soulbound()
    /// error, including a transferFrom sent by the contract's own owner. If one succeeded, a single
    /// Agent ID could be passed around to act as many jurors (review finding R3).
    function test_fork_agentIdIsNotTransferable() public {
        address h = holderFromEnv();
        uint256 tokenId = vm.envOr("AGENT_ID_TOKEN", uint256(0));
        if (h == address(0) || tokenId == 0) vm.skip(true);
        IERC721Transfer nft = IERC721Transfer(AGENT_ID);
        assertEq(nft.ownerOf(tokenId), h);
        address to = address(0xBEEF);

        vm.startPrank(h);
        vm.expectRevert(SOULBOUND);
        nft.transferFrom(h, to, tokenId);
        vm.expectRevert(SOULBOUND);
        nft.safeTransferFrom(h, to, tokenId);
        vm.expectRevert(SOULBOUND);
        nft.approve(to, tokenId);
        vm.expectRevert(SOULBOUND);
        nft.setApprovalForAll(to, true);
        vm.stopPrank();

        vm.prank(AGENT_ID_OWNER);
        vm.expectRevert(SOULBOUND);
        nft.transferFrom(h, to, tokenId);
        assertEq(nft.ownerOf(tokenId), h);
    }

    /// The admin surface of Agent ID at FORK_BLOCK: four setters behind onlyOwner, and the owner
    /// is also the signer that approves self-registration.
    function test_fork_adminFunctionsAreOwnerOnly() public {
        IAgentIDAdmin admin = IAgentIDAdmin(AGENT_ID);
        assertEq(admin.signer(), AGENT_ID_OWNER, "owner is also the registration signer");
        address stranger = address(0xdEaD);
        bytes memory denied = abi.encodeWithSelector(OWNABLE_UNAUTHORIZED, stranger);

        vm.startPrank(stranger);
        vm.expectRevert(denied);
        admin.adminRegister("sealflareprobe", address(0xBEEF));
        vm.expectRevert(denied);
        admin.setSigner(stranger);
        vm.expectRevert(denied);
        admin.setLengthBounds(1, 64);
        vm.expectRevert(denied);
        admin.setURIParts("a", "b");
        vm.stopPrank();
    }

    /// The owner can mint an Agent ID to any address without a signature. Sealflare treats every
    /// Agent ID as one person, so this is a trust assumption on the Agent ID owner (sybil jurors).
    function test_fork_ownerCanMintAgentIdToAnyAddress() public {
        address fresh = address(uint160(uint256(keccak256("sealflare.fork.fresh"))));
        assertEq(IAgentID(AGENT_ID).balanceOf(fresh), 0);
        vm.prank(AGENT_ID_OWNER);
        IAgentIDAdmin(AGENT_ID).adminRegister("sealflareprobe", fresh);
        assertEq(IAgentID(AGENT_ID).balanceOf(fresh), 1);
    }

    /// Ownership is moving through Ownable2Step to a Safe 1.3.0 with a 3 of 6 threshold. Recorded so
    /// a rerun at a later block shows whether the transfer was accepted.
    function test_fork_pendingOwnerIsAMultisig() public view {
        address pending = IAgentIDAdmin(AGENT_ID).pendingOwner();
        assertEq(pending, PENDING_OWNER);
        assertEq(ISafe(pending).getThreshold(), 3);
        assertEq(ISafe(pending).getOwners().length, 6);
    }
}

interface IAgentIDAdmin {
    function signer() external view returns (address);
    function pendingOwner() external view returns (address);
    function adminRegister(string calldata handle, address to) external;
    function setSigner(address signer_) external;
    function setLengthBounds(uint8 minLen, uint8 maxLen) external;
    function setURIParts(string calldata base, string calldata suffix) external;
}

interface ISafe {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}
