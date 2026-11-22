// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VectorTest} from "./VectorTest.sol";
import {Ids} from "../src/lib/Ids.sol";

/// Independent check of the target ids the TypeScript reference implementation froze.
contract IdsTest is VectorTest {
    function test_targetIdOfContract_matchesVectors() public view {
        string memory json = _read("ids.json");
        uint256 n = _rows(json, "$.contracts");
        for (uint256 i; i < n; ++i) {
            address target = vm.parseJsonAddress(json, _key("$.contracts", i, "address"));
            assertEq(Ids.targetIdOfContract(target), vm.parseJsonBytes32(json, _key("$.contracts", i, "targetId")));
        }
    }

    function test_skillIds_matchVectors() public view {
        string memory json = _read("ids.json");
        uint256 n = _rows(json, "$.skills");
        for (uint256 i; i < n; ++i) {
            bytes32 canonical = Ids.canonicalBundleHashOf(
                vm.parseJsonBytes32(json, _key("$.skills", i, "contentHash")),
                vm.parseJsonAddress(json, _key("$.skills", i, "publisher"))
            );
            assertEq(canonical, vm.parseJsonBytes32(json, _key("$.skills", i, "canonicalBundleHash")));
            assertEq(Ids.targetIdOfSkill(canonical), vm.parseJsonBytes32(json, _key("$.skills", i, "targetId")));
        }
    }

    function testFuzz_contractAndSkillIdsNeverCollide(address target) public pure {
        bytes32 asHash = bytes32(uint256(uint160(target)));
        assertTrue(Ids.targetIdOfContract(target) != Ids.targetIdOfSkill(asHash));
    }
}
