// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Core} from "../src/Core.sol";
import {Court} from "../src/Court.sol";
import {Vault} from "../src/Vault.sol";
import {MockAgentID} from "../src/stubs/MockAgentID.sol";

/// Deploys the real Core, Vault and Court and wires them in one go. `run` targets a local Anvil
/// node with MockAgentID and writes shared/abi/addresses.local.json in the same shape as
/// DeployLocal, so `pnpm chain:real` is a drop-in for `pnpm chain`. Testnet and mainnet use their
/// own scripts (Tasks 12 and 13).
contract DeployReal is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    string internal constant OUTPUT = "../shared/abi/addresses.local.json";

    error NotLocalChain(uint256 chainId);

    /// Core, Vault(core, treasury), Court(core, vault), then setModules, all from one deployer.
    /// After setModules the deployer holds no authority over any of the three.
    function deploy(address agentId, address treasury) public returns (Core core, Vault vault, Court court) {
        core = new Core(agentId);
        vault = new Vault(address(core), treasury);
        court = new Court(address(core), address(vault));
        core.setModules(address(court), address(vault));
    }

    function run() external {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        vm.startBroadcast();
        MockAgentID agentId = new MockAgentID();
        (Core core, Vault vault, Court court) = deploy(address(agentId), msg.sender);
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "agentId", address(agentId));
        vm.serializeAddress(key, "core", address(core));
        vm.serializeAddress(key, "court", address(court));
        vm.writeJson(vm.serializeAddress(key, "vault", address(vault)), OUTPUT);
    }
}
