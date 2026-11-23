// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Conservative instruction scan. PUSH payloads are data; a metadata tail is data only when
/// its boundary follows INVALID and there is no JUMPDEST anywhere in that tail.
library BytecodeScan {
    function hasDelegatecall(bytes memory code) internal pure returns (bool) {
        uint256 tailStart = code.length;
        if (code.length >= 2) {
            uint256 length = (uint256(uint8(code[code.length - 2])) << 8) | uint8(code[code.length - 1]);
            if (length + 2 < code.length) tailStart = code.length - length - 2;
        }
        uint256 cursor;
        uint8 previous;
        while (cursor < code.length) {
            if (cursor == tailStart && previous == 0xfe && !_hasJumpdest(code, tailStart)) return false;
            uint8 opcode = uint8(code[cursor]);
            if (opcode == 0xf4) return true;
            cursor += opcode >= 0x60 && opcode <= 0x7f ? uint256(opcode) - 0x5f + 1 : 1;
            previous = opcode;
        }
        return false;
    }

    function _hasJumpdest(bytes memory code, uint256 start) private pure returns (bool) {
        for (uint256 i = start; i < code.length; ++i) {
            if (code[i] == 0x5b) return true;
        }
        return false;
    }
}
