// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {Test} from "forge-std/Test.sol";
import {Core} from "../../src/Core.sol";
import {ICore} from "../../src/interfaces/ICore.sol";
import {TargetType, Verdict} from "../../src/interfaces/Types.sol";
import {MockAgentID} from "../../src/stubs/MockAgentID.sol";
import {TinyTarget} from "./Mocks.sol";

/// Deploys Core against MockAgentID and provides the actors and targets the Core tests use.
/// `vault` and `court` stay zero for now: Vault arrives in Task 5 and Court in Task 8, and the
/// fixture fills them in then. Core's module wiring (setModules) is not implemented yet either.
contract Fixture is Test {
    using stdStorage for StdStorage;

    MockAgentID internal agentId;
    ICore internal core;
    address internal vault;
    address internal court;

    function setUp() public virtual {
        agentId = new MockAgentID();
        core = new Core(address(agentId));
    }

    /// A named address holding one Agent ID and 10 BNB.
    function holder(string memory name) public returns (address who) {
        who = makeAddr(name);
        vm.deal(who, 10 ether);
        agentId.setBalance(who, 1);
    }

    /// Deploys a small contract with code and returns its address.
    function deployTarget() public returns (address) {
        return address(new TinyTarget());
    }

    /// The bytes32 target word for a contract address.
    function word(address target) public pure returns (bytes32) {
        return bytes32(uint256(uint160(target)));
    }

    /// Attests on a contract target as `who`, with standard evidence fields.
    function attestAs(address who, address target, Verdict v, uint32 flags) public returns (bytes32) {
        vm.prank(who);
        return core.attest(
            TargetType.SMART_CONTRACT, word(target), v, flags, keccak256("evidence"), "proof", "ipfs://evidence"
        );
    }

    /// Moves a guardian's score without Core.settle (Task 4). GuardianView packs `score` into the
    /// struct's first storage slot; stdstore locates it through getGuardian and patches only those
    /// bits, leaving exists, createdAtBlock and the quota fields untouched.
    function setScore(address guardian, int32 score) public {
        stdstore.target(address(core)).sig("getGuardian(address)").with_key(guardian).depth(1).enable_packed_slots()
            .checked_write_int(int256(score));
    }
}
