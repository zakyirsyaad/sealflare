// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VectorTest} from "./VectorTest.sol";
import {BindTypes} from "../src/lib/BindTypes.sol";

/// The typed data a publisher's owner signs must hash the same in the wallet and in Core.
contract BindTypesTest is VectorTest {
    function test_typeHashes_matchVectors() public view {
        string memory json = _read("eip712.json");
        assertEq(BindTypes.BIND_BY_OWNER_TYPEHASH, vm.parseJsonBytes32(json, ".BindByOwner.typeHash"));
        assertEq(BindTypes.BIND_BY_DEPLOYER_TYPEHASH, vm.parseJsonBytes32(json, ".BindByDeployer.typeHash"));
        assertEq(BindTypes.BIND_BY_OWNER_TYPEHASH, keccak256(bytes(vm.parseJsonString(json, ".BindByOwner.typeString"))));
        assertEq(
            BindTypes.BIND_BY_DEPLOYER_TYPEHASH, keccak256(bytes(vm.parseJsonString(json, ".BindByDeployer.typeString")))
        );
    }

    function test_domainSeparator_bindsChainAndContract() public pure {
        bytes32 a = BindTypes.domainSeparator(56, address(0x1));
        assertTrue(a != BindTypes.domainSeparator(97, address(0x1)));
        assertTrue(a != BindTypes.domainSeparator(56, address(0x2)));
    }

    function testFuzz_ownerDigest_changesWithTheNonce(address target, address holder, uint256 nonce, uint256 deadline)
        public
        pure
    {
        vm.assume(nonce < type(uint256).max);
        assertTrue(
            BindTypes.hashBindByOwner(target, holder, nonce, deadline)
                != BindTypes.hashBindByOwner(target, holder, nonce + 1, deadline)
        );
    }
}
