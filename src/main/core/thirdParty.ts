import { ThirdPartyTool } from "../../shared/types";

export const thirdPartyTools: ThirdPartyTool[] = [
  {
    name: "CFPAOrg I18nUpdateMod3",
    purpose: "Automatically downloads and applies the community Simplified Chinese Minecraft Mod Language Package.",
    url: "https://github.com/CFPAOrg/I18nUpdateMod3",
    license: "AGPL-3.0",
    notes: "Recommended as an optional baseline localization mod. This app links to it but does not redistribute it."
  },
  {
    name: "FTB Quest Localizer",
    purpose: "Exports FTB Quests text into language files for easier translation.",
    url: "https://www.curseforge.com/minecraft/mc-mods/ftb-quest-localizer",
    license: "MIT",
    notes: "Useful for packs whose FTB Quests content is easier to localize in-game first."
  },
  {
    name: "MinecraftModsLocalizer",
    purpose: "Existing desktop reference for AI-assisted Minecraft mod, quest, and Patchouli translation workflows.",
    url: "https://github.com/Y-RyuZU/MinecraftModsLocalizer",
    license: "MIT",
    notes: "Listed for attribution and comparison; this project implements its own workflow."
  },
  {
    name: "Bilibili localization workflow by 柠娜",
    purpose: "Reference workflow for modpack Chinese localization: mods, quests, KubeJS, Patchouli, shaders, and advancements.",
    url: "https://www.bilibili.com/opus/887248644616486931",
    license: "External article; see original page terms.",
    notes: "Used as workflow reference and credited in README."
  }
];
