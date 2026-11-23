// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// A small contract with real runtime code, deployed as an attestation target in tests.
contract TinyTarget {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

/// A target whose `owner()` returns a settable address.
contract OwnedTarget {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function setOwner(address next) external {
        owner = next;
    }
}

/// A target with code and no `owner()` at all: calls to it fall through and return nothing.
contract NoOwnerTarget {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

/// An ERC-1271 wallet that accepts any signature made by `signer`.
contract Wallet1271 {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return this.isValidSignature.selector;
        return 0xffffffff;
    }
}

/// `owner()` loops until it runs out of gas.
contract GasBurnerOwner {
    function owner() external view returns (address) {
        uint256 i;
        while (gasleft() > 0) {
            ++i;
        }
        return address(uint160(i));
    }
}

/// `owner()` returns far more than 32 bytes. The first word is a valid-looking address.
contract LongReturnOwner {
    address public immutable fakeOwner;

    constructor(address fakeOwner_) {
        fakeOwner = fakeOwner_;
    }

    fallback() external {
        address o = fakeOwner;
        assembly {
            mstore(0, o)
            return(0, 0x10000)
        }
    }
}

/// `owner()` always reverts.
contract RevertingOwner {
    function owner() external pure returns (address) {
        revert("no owner");
    }
}

/// Stands in for Vault in Core tests: a settable `core()` and no bonds.
contract FakeVault {
    address public core;

    constructor(address core_) {
        core = core_;
    }

    function activeBond(bytes32) external pure returns (uint256) {
        return 0;
    }
}

/// Stands in for Court in Core tests: settable `core()` and `vault()`. Tests call Core's
/// Court-only functions by pranking this address.
contract FakeCourt {
    address public core;
    address public vault;

    constructor(address core_, address vault_) {
        core = core_;
        vault = vault_;
    }
}
