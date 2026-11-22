// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// Reads the row-object JSON vectors in shared/rules/vectors one row at a time.
/// Foundry's typed array parsers do not accept a wildcard path, so rows are addressed by index.
abstract contract VectorTest is Test {
    string internal constant DIR = "../shared/rules/vectors/";

    function _read(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(DIR, name));
    }

    /// Number of rows in the JSON array at `prefix` ("$" for a top-level array).
    function _rows(string memory json, string memory prefix) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, _row(prefix, n))) ++n;
        assertGt(n, 0, "vector file has no rows");
    }

    function _row(string memory prefix, uint256 i) internal pure returns (string memory) {
        return string.concat(prefix, "[", vm.toString(i), "]");
    }

    function _key(string memory prefix, uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(_row(prefix, i), ".", field);
    }
}
