// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Core} from "../src/Core.sol";
import {Court} from "../src/Court.sol";
import {Vault} from "../src/Vault.sol";
import {DeployCore} from "./DeployCore.s.sol";

/// Release step 2: reads Core from the address file DeployCore wrote, deploys Vault(core,
/// treasury) and Court(core, vault), calls setModules, and adds both to the file. After this
/// the deployer holds no authority over any contract.
///
/// Must be sent by the same deployer account that deployed Core:
///   TREASURY=<address> forge script DeployModules --root contracts --rpc-url $BSC_RPC_URL --account deployer --sender <address> --broadcast --verify
contract DeployModules is Script {
    error MissingTreasury();
    error NotCoreDeployer(address sender, address deployer);
    error ModulesAlreadyWired(address court, address vault);

    function run() external returns (Vault vault, Court court) {
        DeployCore paths = new DeployCore();
        string memory file = paths.outputFor(block.chainid);
        string memory json = vm.readFile(file);
        Core core = Core(vm.parseJsonAddress(json, ".core"));
        address treasury = vm.envOr("TREASURY", address(0));
        if (treasury == address(0)) revert MissingTreasury();
        if (core.court() != address(0)) revert ModulesAlreadyWired(core.court(), core.vault());
        if (msg.sender != core.deployer()) revert NotCoreDeployer(msg.sender, core.deployer());

        vm.startBroadcast();
        vault = new Vault(address(core), treasury);
        court = new Court(address(core), address(vault));
        core.setModules(address(court), address(vault));
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "agentId", core.agentId());
        vm.serializeAddress(key, "deployer", core.deployer());
        vm.serializeAddress(key, "core", address(core));
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeAddress(key, "court", address(court));
        vm.writeJson(vm.serializeAddress(key, "vault", address(vault)), file);
    }
}
