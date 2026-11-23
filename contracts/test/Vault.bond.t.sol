// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vault} from "../src/Vault.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {BondView, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";
import {OwnedTarget, ReentrantReceiver, RejectingReceiver} from "./helpers/Mocks.sol";

// Test-only entry to the internal credit path, which Tasks 6 and 7 reach through Court and bounties.
contract VaultHarness is Vault {
    constructor(address core_, address treasury_) Vault(core_, treasury_) {}

    function credit(address account) external payable {
        _credit(account, msg.value);
    }
}

contract VaultBondTest is Fixture {
    IVault internal v;
    bytes32 internal skillId;
    address internal publisher;

    function setUp() public override {
        super.setUp();
        v = IVault(vault);
        publisher = holder("publisher");
        vm.prank(publisher);
        skillId = core.bindSkill(keccak256("bundle"));
    }

    function depositAs(address who, bytes32 id, uint256 amount) internal {
        vm.prank(who);
        v.depositBond{value: amount}(id);
    }

    function requestAs(address who, bytes32 id) internal {
        vm.prank(who);
        v.requestBondWithdrawal(id);
    }

    function finalizeAs(address who, bytes32 id) internal {
        vm.prank(who);
        v.finalizeBondWithdrawal(id);
    }

    /// A contract target with one attestation and a sponsor, so it exists in Core.
    function sponsoredTarget(address sponsor_) internal returns (address t, bytes32 id) {
        t = deployTarget();
        id = attestAs(holder("attester"), t, Verdict.SAFE, 0);
        vm.prank(sponsor_);
        core.sponsor(id);
    }

    // ---- depositBond ---------------------------------------------------------------------------

    function test_depositBond_byVerifiedPublisher_isActive() public {
        vm.expectEmit(vault);
        emit IVault.BondDeposited(skillId, publisher, 0.3 ether, 0.3 ether);
        depositAs(publisher, skillId, 0.3 ether);
        assertEq(v.activeBond(skillId), 0.3 ether);
        assertEq(v.bondOf(skillId, publisher).amount, 0.3 ether);
        assertEq(vault.balance, 0.3 ether);
    }

    function test_depositBond_bySponsor_isActive() public {
        address s = holder("sponsor");
        (, bytes32 id) = sponsoredTarget(s);
        depositAs(s, id, 0.1 ether);
        assertEq(v.activeBond(id), 0.1 ether);
    }

    function test_depositBond_byStranger_reverts() public {
        address stranger = holder("stranger");
        vm.prank(stranger);
        vm.expectRevert(IVault.NotPublisher.selector);
        v.depositBond{value: 0.1 ether}(skillId);
    }

    function test_depositBond_unknownTarget_reverts() public {
        vm.prank(publisher);
        vm.expectRevert(IVault.NotPublisher.selector);
        v.depositBond{value: 0.1 ether}(keccak256("unknown"));
    }

    function test_depositBond_aboveHalfBnbInTotal_reverts() public {
        depositAs(publisher, skillId, 0.3 ether);
        vm.prank(publisher);
        vm.expectRevert(IVault.BondAboveCap.selector);
        v.depositBond{value: 0.21 ether}(skillId);
        depositAs(publisher, skillId, 0.2 ether);
        assertEq(v.activeBond(skillId), Constants.MAX_WARRANTY_BOND);
    }

    function test_depositBond_zeroValue_reverts() public {
        vm.prank(publisher);
        vm.expectRevert(IVault.TransferFailed.selector);
        v.depositBond{value: 0}(skillId);
    }

    function test_activeBond_ignoresFormerSponsorAfterVerifiedBinding() public {
        (address ownerAddr, uint256 ownerPk) = makeAddrAndKey("owner");
        address owned = address(new OwnedTarget(ownerAddr));
        bytes32 id = attestAs(holder("attester"), owned, Verdict.SAFE, 0);
        address s = holder("sponsor");
        vm.prank(s);
        core.sponsor(id);
        depositAs(s, id, 0.5 ether);
        assertEq(v.activeBond(id), 0.5 ether);

        address newPub = holder("new-publisher");
        bytes memory sig = signBindByOwner(ownerPk, owned, newPub, block.timestamp + 1 hours);
        core.bindByOwner(owned, newPub, block.timestamp + 1 hours, sig);
        assertEq(v.activeBond(id), 0);
        assertEq(v.bondOf(id, s).amount, 0.5 ether);
    }

    // ---- withdrawal of a bond ------------------------------------------------------------------

    function test_requestWithdrawal_makesBondInactiveImmediately() public {
        depositAs(publisher, skillId, 0.3 ether);
        uint64 expected = uint64(block.timestamp) + Constants.BOND_UNBONDING;
        vm.expectEmit(vault);
        emit IVault.BondWithdrawalRequested(skillId, publisher, expected);
        requestAs(publisher, skillId);
        assertEq(v.bondOf(skillId, publisher).withdrawalAvailableAt, expected);
        assertEq(v.activeBond(skillId), 0);
    }

    function test_requestWithdrawal_withoutBond_reverts() public {
        vm.prank(publisher);
        vm.expectRevert(IVault.NothingToWithdraw.selector);
        v.requestBondWithdrawal(skillId);
    }

    function test_depositBond_cancelsPendingWithdrawal() public {
        depositAs(publisher, skillId, 0.3 ether);
        requestAs(publisher, skillId);
        depositAs(publisher, skillId, 0.1 ether);
        assertEq(v.bondOf(skillId, publisher).withdrawalAvailableAt, 0);
        assertEq(v.activeBond(skillId), 0.4 ether);
    }

    function test_finalize_before7Days_reverts() public {
        depositAs(publisher, skillId, 0.3 ether);
        requestAs(publisher, skillId);
        uint64 availableAt = v.bondOf(skillId, publisher).withdrawalAvailableAt;
        vm.warp(availableAt - 1);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(IVault.WithdrawalNotReady.selector, availableAt));
        v.finalizeBondWithdrawal(skillId);
    }

    function test_finalize_withoutRequest_reverts() public {
        depositAs(publisher, skillId, 0.3 ether);
        vm.prank(publisher);
        vm.expectRevert(IVault.NoWithdrawalRequested.selector);
        v.finalizeBondWithdrawal(skillId);
    }

    function test_finalize_after7Days_creditsBalanceAndClearsBond() public {
        depositAs(publisher, skillId, 0.3 ether);
        requestAs(publisher, skillId);
        vm.warp(block.timestamp + Constants.BOND_UNBONDING);
        vm.expectEmit(vault);
        emit IVault.BondWithdrawn(skillId, publisher, 0.3 ether);
        vm.expectEmit(vault);
        emit IVault.BalanceCredited(publisher, 0.3 ether);
        finalizeAs(publisher, skillId);
        BondView memory b = v.bondOf(skillId, publisher);
        assertEq(b.amount, 0);
        assertEq(b.withdrawalAvailableAt, 0);
        assertEq(v.balanceOf(publisher), 0.3 ether);
    }

    function test_finalize_whileLocked_reverts() public {
        // Completed in Task 6, once Court can lock a bond through lockBond.
        vm.skip(true);
    }

    function test_formerSponsor_canStillWithdrawOwnBond() public {
        (address ownerAddr, uint256 ownerPk) = makeAddrAndKey("owner");
        address owned = address(new OwnedTarget(ownerAddr));
        bytes32 id = attestAs(holder("attester"), owned, Verdict.SAFE, 0);
        address s = holder("sponsor");
        vm.prank(s);
        core.sponsor(id);
        depositAs(s, id, 0.2 ether);
        bytes memory sig = signBindByOwner(ownerPk, owned, publisher, block.timestamp + 1 hours);
        core.bindByOwner(owned, publisher, block.timestamp + 1 hours, sig);

        requestAs(s, id);
        vm.warp(block.timestamp + Constants.BOND_UNBONDING);
        finalizeAs(s, id);
        assertEq(v.balanceOf(s), 0.2 ether);
    }

    // ---- withdraw ------------------------------------------------------------------------------

    function harness() internal returns (VaultHarness h) {
        h = new VaultHarness(address(core), treasury);
    }

    function test_withdraw_paysExactBalanceAndZeroesIt() public {
        VaultHarness h = harness();
        address alice = makeAddr("alice");
        h.credit{value: 0.07 ether}(alice);
        vm.expectEmit(address(h));
        emit IVault.Withdrawn(alice, 0.07 ether);
        vm.prank(alice);
        h.withdraw();
        assertEq(alice.balance, 0.07 ether);
        assertEq(h.balanceOf(alice), 0);
        assertEq(address(h).balance, 0);
    }

    function test_withdraw_nothing_reverts() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert(IVault.NothingToWithdraw.selector);
        v.withdraw();
    }

    function test_withdraw_reentrantReceiver_cannotDrain() public {
        VaultHarness h = harness();
        ReentrantReceiver attacker = new ReentrantReceiver(address(h));
        address bystander = makeAddr("bystander");
        h.credit{value: 1 ether}(address(attacker));
        h.credit{value: 2 ether}(bystander);

        attacker.attack();
        assertTrue(attacker.reentered());
        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, 1 ether);
        assertEq(h.balanceOf(address(attacker)), 0);
        assertEq(h.balanceOf(bystander), 2 ether);
        assertEq(address(h).balance, 2 ether);
    }

    function test_withdraw_rejectingReceiver_revertsAndKeepsBalance() public {
        VaultHarness h = harness();
        RejectingReceiver r = new RejectingReceiver();
        h.credit{value: 0.5 ether}(address(r));
        vm.expectRevert(IVault.TransferFailed.selector);
        r.pull(address(h));
        assertEq(h.balanceOf(address(r)), 0.5 ether);
        assertEq(address(h).balance, 0.5 ether);
    }

    function test_vault_rejectsPlainTransfer() public {
        (bool ok,) = vault.call{value: 1}("");
        assertFalse(ok);
        assertEq(vault.balance, 0);
    }

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(IVault.TransferFailed.selector);
        new Vault(address(0), treasury);
        vm.expectRevert(IVault.TransferFailed.selector);
        new Vault(address(core), address(0));
    }

    function test_core_and_treasury_areSet() public view {
        assertEq(v.core(), address(core));
        assertEq(v.treasury(), treasury);
    }
}
