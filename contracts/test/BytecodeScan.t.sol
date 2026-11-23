// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BytecodeScan} from "../src/lib/BytecodeScan.sol";

contract BytecodeScanTest is Test {
    function test_scan_plainDelegatecall_isFound() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"6000f4"));
    }

    function test_scan_f4InsidePushData_isIgnored() public pure {
        assertFalse(BytecodeScan.hasDelegatecall(hex"61f4f400"));
        assertFalse(
            BytecodeScan.hasDelegatecall(abi.encodePacked(hex"7f", bytes32(type(uint256).max / 255 * 244), hex"00"))
        );
    }

    function test_scan_f4AfterPushData_isFound() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"60f4f4"));
    }

    function test_scan_truncatedPushAtEnd_doesNotRevert() public pure {
        assertFalse(BytecodeScan.hasDelegatecall(hex"7f0102"));
    }

    function test_scan_eip1167MinimalProxy_isFound() public pure {
        assertTrue(
            BytecodeScan.hasDelegatecall(
                abi.encodePacked(hex"363d3d373d3d3d363d73", address(1), hex"5af43d82803e903d91602b57fd5bf3")
            )
        );
    }

    function test_scan_unreachableMetadataTail_isSkipped() public pure {
        assertFalse(BytecodeScan.hasDelegatecall(hex"00fef4000002"));
    }

    function test_scan_tailWithJumpdest_isScanned() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"00fe5bf4000003"));
    }

    function test_scan_tailNotPrecededByInvalid_isScanned() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"0000f4000003"));
    }

    function test_scan_declaredTailLongerThanCode_isScanned() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"f4ffff"));
    }

    function test_scan_emptyCode_isFalse() public pure {
        assertFalse(BytecodeScan.hasDelegatecall(hex""));
    }

    function test_scan_push0_doesNotSkipNextOpcode() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"5ff4"));
    }

    function test_scan_invalidInsidePushDoesNotProveUnreachable() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"60fef4000003"));
    }

    function test_scan_tailBoundaryInsidePush_isNotSkipped() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"60fe60f4f4000004"));
    }

    function test_scan_tailCoveringWholeCode_isScanned() public pure {
        assertTrue(BytecodeScan.hasDelegatecall(hex"f40001"));
    }

    function testFuzz_scan_neverReverts(bytes memory code) public pure {
        BytecodeScan.hasDelegatecall(code);
    }
}
