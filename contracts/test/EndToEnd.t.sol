// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Core} from "../src/Core.sol";
import {Court} from "../src/Court.sol";
import {Vault} from "../src/Vault.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {ICourt} from "../src/interfaces/ICourt.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {ChallengeOutcome, TrustTier, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {DeployReal} from "../script/DeployReal.s.sol";
import {Fixture} from "./helpers/Fixture.sol";
import {OwnedTarget} from "./helpers/Mocks.sol";

/// Whole protocol stories over the real Core, Vault and Court, from first vote to withdrawal.
contract EndToEndTest is Fixture {
    bytes32 internal constant SALT = keccak256("salt");

    address internal ownerAddr;
    uint256 internal ownerPk;
    address internal target;
    bytes32 internal id;
    address internal publisher;
    address[3] internal guardians;

    function setUp() public override {
        super.setUp();
        (ownerAddr, ownerPk) = makeAddrAndKey("owner");
        target = address(new OwnedTarget(ownerAddr));
        id = core.targetIdOfContract(target);
        publisher = holder("publisher");
        guardians = [holder("guardian-0"), holder("guardian-1"), holder("guardian-2")];
    }

    // ---- story helpers -------------------------------------------------------------------------

    function bindPublisher() internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signBindByOwner(ownerPk, target, publisher, deadline);
        core.bindByOwner(target, publisher, deadline, sig);
    }

    function threeSafeVotes() internal {
        for (uint256 i = 0; i < 3; ++i) {
            attestAs(guardians[i], target, Verdict.SAFE, 0);
        }
    }

    function jurorPool(uint256 n) internal returns (address[] memory js) {
        js = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            js[i] = juror(string.concat("juror-", vm.toString(i)), 0);
        }
    }

    function decide(uint256 challengeId, address[] memory js, bool[] memory uphold) internal {
        for (uint256 i = 0; i < js.length; ++i) {
            commitAs(js[i], challengeId, uphold[i], SALT);
        }
        toCommitPhaseEnd(challengeId);
        for (uint256 i = 0; i < js.length; ++i) {
            revealAs(js[i], challengeId, uphold[i], SALT);
        }
        toRevealPhaseEnd(challengeId);
        ICourt(court).resolve(challengeId);
    }

    /// Withdraws and checks the wallet grew by exactly the credited balance, which must be `expected`.
    function withdrawExactly(address who, uint256 expected) internal {
        assertEq(IVault(vault).balanceOf(who), expected);
        uint256 before = who.balance;
        vm.prank(who);
        IVault(vault).withdraw();
        assertEq(who.balance - before, expected);
        assertEq(IVault(vault).balanceOf(who), 0);
    }

    function tier() internal view returns (TrustTier) {
        return core.tierOf(id);
    }

    // ---- stories -------------------------------------------------------------------------------

    function test_e2e_safeTargetChallengedAndConfirmedDangerous() public {
        wireModules();
        bindPublisher();
        vm.prank(publisher);
        IVault(vault).depositBond{value: 0.4 ether}(id);
        threeSafeVotes();
        assertEq(uint8(tier()), uint8(TrustTier.WARRANTY_BACKED_SAFE));

        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        core.settle(id, 0, 3);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(core.getGuardian(guardians[i]).score, 2);
        }

        address[] memory js = jurorPool(4);
        address challenger = holder("challenger");
        vm.roll(block.number + 1);
        uint256 challengeId = openChallengeAs(challenger, id);
        assertEq(uint8(tier()), uint8(TrustTier.DISPUTED_CAUTION));

        bool[] memory uphold = new bool[](4);
        (uphold[0], uphold[1], uphold[2]) = (true, true, true);
        decide(challengeId, js, uphold);
        assertEq(uint8(tier()), uint8(TrustTier.CONFIRMED_DANGER));
        assertEq(IVault(vault).bondOf(id, publisher).amount, 0.2 ether);

        core.applyPenalties(id, 0, 3);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(core.getGuardian(guardians[i]).score, -13);
        }

        // escrow 0.23 = 0.01 + 4 x 0.005 + 0.2 slashed; pool 0.205 after the returned stakes
        withdrawExactly(challenger, 0.01 ether + 0.1025 ether);
        for (uint256 i = 0; i < 3; ++i) {
            withdrawExactly(js[i], 0.005 ether + 0.034166666666666666 ether);
        }
        assertEq(IVault(vault).balanceOf(js[3]), 0);
        assertEq(IVault(vault).balanceOf(treasury), 2);
        assertEq(IVault(vault).escrowOf(challengeId), 0);

        (TrustTier t,,,,) = core.verifyContract(target);
        assertEq(uint8(t), uint8(TrustTier.CONFIRMED_DANGER));
    }

    function test_e2e_falseChallengeIsRejectedAndTargetRecovers() public {
        wireModules();
        threeSafeVotes();
        assertEq(uint8(tier()), uint8(TrustTier.COMMUNITY_SAFE));

        address[] memory js = jurorPool(3);
        address challenger = juror("challenger", 0);
        vm.roll(block.number + 1);
        uint256 challengeId = openChallengeAs(challenger, id);
        decide(challengeId, js, new bool[](3));

        assertEq(uint8(ICourt(court).getChallenge(challengeId).outcome), uint8(ChallengeOutcome.REJECTED));
        assertEq(uint8(tier()), uint8(TrustTier.COMMUNITY_SAFE));
        assertEq(core.getGuardian(challenger).score, -5);
        assertEq(IVault(vault).balanceOf(challenger), 0);
        for (uint256 i = 0; i < 3; ++i) {
            withdrawExactly(js[i], 0.005 ether + 0.003333333333333333 ether);
        }

        // Votes cast before the dispute are paid once it closed without a danger verdict and their
        // own 48 hours have passed; the dispute neither extended nor shortened that window.
        core.settle(id, 0, 3);
        assertEq(core.getGuardian(guardians[0]).score, 0);
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        core.settle(id, 0, 3);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(core.getGuardian(guardians[i]).score, 2);
        }
    }

    function test_e2e_bountyFilledAndSettled() public {
        address requester = holder("requester");
        vm.prank(requester);
        uint256 bountyId = IVault(vault).createBounty{value: 0.09 ether}(id, 3);
        threeSafeVotes();
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        IVault(vault).settleBounty(bountyId);

        for (uint256 i = 0; i < 3; ++i) {
            withdrawExactly(guardians[i], 0.0285 ether);
        }
        withdrawExactly(treasury, 0.0045 ether);
        assertEq(IVault(vault).balanceOf(requester), 0);
        assertEq(vault.balance, 0);
    }

    function test_e2e_coreWorksAloneBeforeModulesAreSet() public {
        assertEq(core.court(), address(0));
        assertEq(core.vault(), address(0));
        bindPublisher();
        threeSafeVotes();
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        core.settle(id, 0, 3);
        assertEq(core.getGuardian(guardians[0]).score, 2);
        assertEq(uint8(tier()), uint8(TrustTier.COMMUNITY_SAFE));

        (TrustTier t,, bytes32 pinned, uint32 flags, uint256 bond) = core.verifyContract(target);
        assertEq(uint8(t), uint8(TrustTier.COMMUNITY_SAFE));
        assertEq(pinned, target.codehash);
        assertEq(flags, 0);
        assertEq(bond, 0);
        (TrustTier skillTier,,,) = core.verifySkillBundle(keccak256("unknown"));
        assertEq(uint8(skillTier), uint8(TrustTier.UNRATED));
    }

    function test_e2e_modulesAttachToAnAlreadyUsedCore() public {
        // A Core that has lived alone for a while, with votes and a verified publisher.
        core = new Core(address(agentId));
        id = core.targetIdOfContract(target);
        bindPublisher();
        threeSafeVotes();
        address[] memory js = jurorPool(3);

        // The modules arrive later and are wired by the deployer.
        vault = address(new Vault(address(core), treasury));
        court = address(new Court(address(core), vault));
        core.setModules(court, vault);

        vm.prank(publisher);
        IVault(vault).depositBond{value: 0.4 ether}(id);
        assertEq(uint8(tier()), uint8(TrustTier.WARRANTY_BACKED_SAFE));

        vm.roll(block.number + 1);
        uint256 challengeId = openChallengeAs(holder("challenger"), id);
        bool[] memory uphold = new bool[](3);
        (uphold[0], uphold[1], uphold[2]) = (true, true, true);
        decide(challengeId, js, uphold);
        assertEq(uint8(tier()), uint8(TrustTier.CONFIRMED_DANGER));
        assertEq(IVault(vault).bondOf(id, publisher).amount, 0.2 ether);
    }

    function test_deployReal_wiresModulesAndEndsDeployerAuthority() public {
        DeployReal script = new DeployReal();
        (Core c, Vault v, Court ct) = script.deploy(address(agentId), treasury);

        assertEq(c.court(), address(ct));
        assertEq(c.vault(), address(v));
        assertEq(v.core(), address(c));
        assertEq(v.treasury(), treasury);
        assertEq(ct.core(), address(c));
        assertEq(ct.vault(), address(v));
        assertEq(c.agentId(), address(agentId));

        vm.prank(c.deployer());
        vm.expectRevert(ICore.ModulesAlreadySet.selector);
        c.setModules(address(ct), address(v));
    }
}
