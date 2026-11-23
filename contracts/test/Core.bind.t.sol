// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICore} from "../src/interfaces/ICore.sol";
import {BindMethod, PublisherRole, TargetView} from "../src/interfaces/Types.sol";
import {BindTypes} from "../src/lib/BindTypes.sol";
import {Ids} from "../src/lib/Ids.sol";
import {Fixture} from "./helpers/Fixture.sol";
import {
    GasBurnerOwner,
    LongReturnOwner,
    NoOwnerTarget,
    OwnedTarget,
    RevertingOwner,
    Wallet1271
} from "./helpers/Mocks.sol";

contract CoreBindTest is Fixture {
    uint256 internal ownerPk;
    address internal ownerAddr;
    address internal pub;
    address internal other;
    OwnedTarget internal owned;
    bytes32 internal id;
    uint256 internal deadline;

    function setUp() public override {
        super.setUp();
        (ownerAddr, ownerPk) = makeAddrAndKey("owner");
        pub = holder("publisher");
        other = holder("other");
        owned = new OwnedTarget(ownerAddr);
        id = Ids.targetIdOfContract(address(owned));
        deadline = block.timestamp + 1 hours;
    }

    function bindOwned(address agentIdHolder) internal {
        bytes memory sig = signBindByOwner(ownerPk, address(owned), agentIdHolder, deadline);
        core.bindByOwner(address(owned), agentIdHolder, deadline, sig);
    }

    function assertPublisher(bytes32 targetId, address expected, PublisherRole role) internal view {
        TargetView memory t = core.getTarget(targetId);
        assertEq(t.publisher, expected);
        assertEq(uint8(t.publisherRole), uint8(role));
    }

    // ---- bindByOwner -------------------------------------------------------------------------

    function test_bindByOwner_validSignature_bindsHolderAsVerified() public {
        assertEq(core.bindNonce(address(owned)), 0);
        vm.expectEmit(address(core));
        emit ICore.PublisherBound(id, pub, PublisherRole.VERIFIED_PUBLISHER, BindMethod.OWNER);
        bindOwned(pub);
        assertPublisher(id, pub, PublisherRole.VERIFIED_PUBLISHER);
        assertEq(core.bindNonce(address(owned)), 1);
    }

    function test_bindByOwner_callerNeedNotBeHolderOrOwner() public {
        bytes memory sig = signBindByOwner(ownerPk, address(owned), pub, deadline);
        vm.prank(makeAddr("relayer"));
        core.bindByOwner(address(owned), pub, deadline, sig);
        assertPublisher(id, pub, PublisherRole.VERIFIED_PUBLISHER);
    }

    function test_bindByOwner_holderWithoutAgentId_reverts() public {
        address nobody = makeAddr("nobody");
        bytes memory sig = signBindByOwner(ownerPk, address(owned), nobody, deadline);
        vm.expectRevert(ICore.NotAgentIdHolder.selector);
        core.bindByOwner(address(owned), nobody, deadline, sig);
    }

    function test_bindByOwner_expiredDeadline_reverts() public {
        bytes memory sig = signBindByOwner(ownerPk, address(owned), pub, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(ICore.SignatureExpired.selector);
        core.bindByOwner(address(owned), pub, deadline, sig);
    }

    function test_bindByOwner_signatureByNonOwner_reverts() public {
        (, uint256 strangerPk) = makeAddrAndKey("stranger");
        bytes memory sig = signBindByOwner(strangerPk, address(owned), pub, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(address(owned), pub, deadline, sig);
    }

    function test_bindByOwner_replayAfterRebind_reverts() public {
        bytes memory sigX = signBindByOwner(ownerPk, address(owned), pub, deadline);
        core.bindByOwner(address(owned), pub, deadline, sigX);
        bindOwned(other);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(address(owned), pub, deadline, sigX);
        assertPublisher(id, other, PublisherRole.VERIFIED_PUBLISHER);
    }

    function test_bindByOwner_signatureForOtherChainOrCore_reverts() public {
        bytes32 structHash = BindTypes.hashBindByOwner(address(owned), pub, 0, deadline);
        bytes memory otherChain = signDigest(ownerPk, BindTypes.domainSeparator(999, address(core)), structHash);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(address(owned), pub, deadline, otherChain);

        bytes memory otherCore =
            signDigest(ownerPk, BindTypes.domainSeparator(block.chainid, makeAddr("core2")), structHash);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(address(owned), pub, deadline, otherCore);
    }

    function test_bindByOwner_erc1271Owner_isAccepted() public {
        (address signer, uint256 signerPk) = makeAddrAndKey("walletSigner");
        OwnedTarget walletOwned = new OwnedTarget(address(new Wallet1271(signer)));
        bytes memory sig = signBindByOwner(signerPk, address(walletOwned), pub, deadline);
        core.bindByOwner(address(walletOwned), pub, deadline, sig);
        assertPublisher(Ids.targetIdOfContract(address(walletOwned)), pub, PublisherRole.VERIFIED_PUBLISHER);
    }

    function test_bindByOwner_newOwnerReplacesVerifiedPublisher() public {
        bindOwned(pub);
        (address newOwner, uint256 newPk) = makeAddrAndKey("newOwner");
        owned.setOwner(newOwner);

        bytes memory oldOwnerSig = signBindByOwner(ownerPk, address(owned), other, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(address(owned), other, deadline, oldOwnerSig);

        bytes memory sig = signBindByOwner(newPk, address(owned), other, deadline);
        core.bindByOwner(address(owned), other, deadline, sig);
        assertPublisher(id, other, PublisherRole.VERIFIED_PUBLISHER);
    }

    function test_bindByOwner_targetWithoutOwner_reverts() public {
        address target = address(new NoOwnerTarget());
        bytes memory sig = signBindByOwner(ownerPk, target, pub, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(target, pub, deadline, sig);
    }

    function test_bindByOwner_ownerCallBurnsGas_revertsCleanly() public {
        address target = address(new GasBurnerOwner());
        bytes memory sig = signBindByOwner(ownerPk, target, pub, deadline);
        uint256 start = gasleft();
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(target, pub, deadline, sig);
        assertLt(start - gasleft(), 100_000);
    }

    function test_bindByOwner_ownerReturnsLongData_reverts() public {
        address target = address(new LongReturnOwner(ownerAddr));
        bytes memory sig = signBindByOwner(ownerPk, target, pub, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(target, pub, deadline, sig);
    }

    function test_bindByOwner_ownerReverts_reverts() public {
        address target = address(new RevertingOwner());
        bytes memory sig = signBindByOwner(ownerPk, target, pub, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByOwner(target, pub, deadline, sig);
    }

    function test_bindByOwner_upgradesSponsorToVerified() public {
        probe(address(owned));
        vm.prank(other);
        core.sponsor(id);
        assertPublisher(id, other, PublisherRole.THIRD_PARTY_SPONSOR);
        bindOwned(pub);
        assertPublisher(id, pub, PublisherRole.VERIFIED_PUBLISHER);
    }

    // ---- bindByDeployer ----------------------------------------------------------------------

    function deployFrom(address from) internal returns (address target, uint256 nonce) {
        nonce = vm.getNonce(from);
        vm.prank(from);
        target = address(new NoOwnerTarget());
        assertEq(target, vm.computeCreateAddress(from, nonce));
    }

    function test_bindByDeployer_validProof_bindsHolder() public {
        (address dep, uint256 depPk) = makeAddrAndKey("deployer");
        (address target, uint256 nonce) = deployFrom(dep);
        bytes memory sig = signBindByDeployer(depPk, target, dep, nonce, pub, deadline);
        vm.expectEmit(address(core));
        emit ICore.PublisherBound(
            Ids.targetIdOfContract(target), pub, PublisherRole.VERIFIED_PUBLISHER, BindMethod.DEPLOYER
        );
        core.bindByDeployer(target, dep, nonce, pub, deadline, sig);
        assertPublisher(Ids.targetIdOfContract(target), pub, PublisherRole.VERIFIED_PUBLISHER);
        assertEq(core.bindNonce(target), 1);
    }

    function test_bindByDeployer_targetHasOwner_reverts() public {
        (address dep, uint256 depPk) = makeAddrAndKey("deployer");
        uint256 nonce = vm.getNonce(dep);
        vm.prank(dep);
        address target = address(new OwnedTarget(ownerAddr));
        bytes memory sig = signBindByDeployer(depPk, target, dep, nonce, pub, deadline);
        vm.expectRevert(ICore.TargetHasOwner.selector);
        core.bindByDeployer(target, dep, nonce, pub, deadline, sig);
    }

    function test_bindByDeployer_wrongNonce_reverts() public {
        (address dep, uint256 depPk) = makeAddrAndKey("deployer");
        (address target, uint256 nonce) = deployFrom(dep);
        bytes memory sig = signBindByDeployer(depPk, target, dep, nonce + 1, pub, deadline);
        vm.expectRevert(ICore.DeployerMismatch.selector);
        core.bindByDeployer(target, dep, nonce + 1, pub, deadline, sig);
    }

    function test_bindByDeployer_alreadyVerified_reverts() public {
        (address dep, uint256 depPk) = makeAddrAndKey("deployer");
        (address target, uint256 nonce) = deployFrom(dep);
        core.bindByDeployer(
            target, dep, nonce, pub, deadline, signBindByDeployer(depPk, target, dep, nonce, pub, deadline)
        );
        bytes memory sig = signBindByDeployer(depPk, target, dep, nonce, other, deadline);
        vm.expectRevert(ICore.AlreadyVerifiedPublisher.selector);
        core.bindByDeployer(target, dep, nonce, other, deadline, sig);
    }

    function test_bindByDeployer_replay_reverts() public {
        (address dep, uint256 depPk) = makeAddrAndKey("deployer");
        (address target, uint256 nonce) = deployFrom(dep);
        bytes memory sig = signBindByDeployer(depPk, target, dep, nonce, other, deadline);
        core.bindByDeployer(target, dep, nonce, other, deadline, sig);
        // The signature is checked before the publisher state, so a replay fails on the spent nonce.
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByDeployer(target, dep, nonce, other, deadline, sig);
    }

    function test_bindByDeployer_signatureByOtherKey_reverts() public {
        (address dep,) = makeAddrAndKey("deployer");
        (, uint256 strangerPk) = makeAddrAndKey("stranger");
        (address target, uint256 nonce) = deployFrom(dep);
        bytes memory sig = signBindByDeployer(strangerPk, target, dep, nonce, pub, deadline);
        vm.expectRevert(ICore.InvalidSignature.selector);
        core.bindByDeployer(target, dep, nonce, pub, deadline, sig);
    }

    // ---- bindSkill ---------------------------------------------------------------------------

    function test_bindSkill_usesSenderInCanonicalHash() public {
        bytes32 content = keccak256("bundle");
        bytes32 expected = Ids.targetIdOfSkill(Ids.canonicalBundleHashOf(content, pub));
        vm.expectEmit(address(core));
        emit ICore.PublisherBound(expected, pub, PublisherRole.VERIFIED_PUBLISHER, BindMethod.SKILL);
        vm.prank(pub);
        bytes32 targetId = core.bindSkill(content);
        assertEq(targetId, expected);
        assertPublisher(targetId, pub, PublisherRole.VERIFIED_PUBLISHER);
        assertEq(core.getTarget(targetId).target, Ids.canonicalBundleHashOf(content, pub));
    }

    function test_bindSkill_otherAccountSameContent_getsDifferentTarget() public {
        bytes32 content = keccak256("bundle");
        vm.prank(pub);
        bytes32 a = core.bindSkill(content);
        vm.prank(other);
        bytes32 b = core.bindSkill(content);
        assertTrue(a != b);
        assertPublisher(a, pub, PublisherRole.VERIFIED_PUBLISHER);
        assertPublisher(b, other, PublisherRole.VERIFIED_PUBLISHER);
    }

    function test_bindSkill_notHolder_reverts() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert(ICore.NotAgentIdHolder.selector);
        core.bindSkill(keccak256("bundle"));
    }

    function test_bindSkill_twice_reverts() public {
        vm.startPrank(pub);
        core.bindSkill(keccak256("bundle"));
        vm.expectRevert(ICore.AlreadyVerifiedPublisher.selector);
        core.bindSkill(keccak256("bundle"));
        vm.stopPrank();
    }

    // ---- sponsor -----------------------------------------------------------------------------

    function probe(address target) internal {
        core.probeBytecode(target);
    }

    function test_sponsor_unclaimedTarget_recordsSponsor() public {
        probe(address(owned));
        vm.expectEmit(address(core));
        emit ICore.PublisherBound(id, other, PublisherRole.THIRD_PARTY_SPONSOR, BindMethod.SPONSOR);
        vm.prank(other);
        core.sponsor(id);
        assertPublisher(id, other, PublisherRole.THIRD_PARTY_SPONSOR);
    }

    function test_sponsor_unknownTarget_reverts() public {
        vm.prank(other);
        vm.expectRevert(ICore.TargetNotFound.selector);
        core.sponsor(id);
    }

    function test_sponsor_targetWithPublisher_reverts() public {
        bindOwned(pub);
        vm.prank(other);
        vm.expectRevert(ICore.PublisherAlreadyBound.selector);
        core.sponsor(id);
    }

    function test_sponsor_secondSponsor_reverts() public {
        probe(address(owned));
        vm.prank(other);
        core.sponsor(id);
        vm.prank(pub);
        vm.expectRevert(ICore.PublisherAlreadyBound.selector);
        core.sponsor(id);
    }

    function test_sponsor_notHolder_reverts() public {
        probe(address(owned));
        vm.prank(makeAddr("nobody"));
        vm.expectRevert(ICore.NotAgentIdHolder.selector);
        core.sponsor(id);
    }

    // ---- domain ------------------------------------------------------------------------------

    function test_domainSeparator_matchesBindTypes() public view {
        assertEq(core.DOMAIN_SEPARATOR(), BindTypes.domainSeparator(block.chainid, address(core)));
    }
}
