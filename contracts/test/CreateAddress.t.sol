// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CreateAddress} from "../src/lib/CreateAddress.sol";

contract CreateAddressTest is Test {
    address internal constant DEPLOYER = 0x6AC7EA33F8831EA9dcC53393aAA88B25A785DBF0;

    function test_compute_matchesFoundry_forBoundaryNonces() public pure {
        uint64[9] memory nonces = [uint64(0), 1, 0x7f, 0x80, 0xff, 0x100, 0xffff, 0x10000, type(uint64).max];
        for (uint256 i = 0; i < nonces.length; ++i) {
            assertEq(CreateAddress.compute(DEPLOYER, nonces[i]), vm.computeCreateAddress(DEPLOYER, nonces[i]));
        }
    }

    function testFuzz_compute_matchesFoundry(address deployer, uint64 nonce) public pure {
        assertEq(CreateAddress.compute(deployer, nonce), vm.computeCreateAddress(deployer, nonce));
    }

    function test_compute_nonceAboveUint64_isZeroAddress() public pure {
        assertEq(CreateAddress.compute(DEPLOYER, uint256(type(uint64).max) + 1), address(0));
        assertEq(CreateAddress.compute(DEPLOYER, type(uint256).max), address(0));
    }
}
