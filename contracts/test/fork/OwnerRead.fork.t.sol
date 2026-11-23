// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {OwnerRead} from "../../src/lib/OwnerRead.sol";
import {ForkBase} from "./ForkBase.sol";

/// OwnerRead against real BSC contracts at FORK_BLOCK.
contract OwnerReadForkTest is ForkBase {
    /// BSC-USD (Binance-Peg USDT), a plain Ownable BEP-20.
    /// https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955
    address internal constant BSC_USD = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant BSC_USD_OWNER = 0xF68a4b64162906efF0fF6aE34E2bB1Cd42FEf62d;
    /// WBNB: no owner(), and a payable fallback that deposits, which cannot succeed in a static call.
    /// https://bscscan.com/address/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
    address internal constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    /// Binance-Peg USDC, an EIP-1967 proxy whose owner() reverts.
    /// https://bscscan.com/address/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
    address internal constant USDC_PROXY = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    function test_fork_ownerOf_onRealOwnableContract() public view {
        assertEq(OwnerRead.ownerOf(BSC_USD), BSC_USD_OWNER);
        assertEq(OwnerRead.ownerOf(AGENT_ID), AGENT_ID_OWNER);
    }

    function test_fork_ownerOf_onContractWithOnlyFallback() public view {
        assertGt(WBNB.code.length, 0);
        assertEq(OwnerRead.ownerOf(WBNB), address(0));
    }

    function test_fork_ownerOf_onProxy() public view {
        assertGt(uint256(vm.load(USDC_PROXY, bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1))), 0);
        assertEq(OwnerRead.ownerOf(USDC_PROXY), address(0));
    }

    function test_fork_ownerOf_onEoa_isZero() public view {
        assertEq(AGENT_ID_OWNER.code.length, 0);
        assertEq(OwnerRead.ownerOf(AGENT_ID_OWNER), address(0));
    }
}
