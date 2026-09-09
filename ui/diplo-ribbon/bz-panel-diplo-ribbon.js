import { ComponentUtilities } from '/core/ui-next/utilities/component-utilities.js';
import { DiploRibbonData } from '/base-standard/ui/diplo-ribbon/model-diplo-ribbon.js';
import { InterfaceMode } from '../../../core/ui/interface-modes/interface-modes.js';
import '/base-standard/ui/diplo-ribbon/panel-diplo-ribbon.js';

const isIdeographic = Locale.getCurrentDisplayLocale().startsWith('zh_');
const BZ_YIELD_COMBAT_STRENGTH = [
    "[icon:NAR_REW_COMBAT]",
    Locale.compose("LOC_ADVICE_ANTIQUITY_MILITARY_COMBAT_STRENGTH_TITLE"),
].join(isIdeographic ? "" : " ");

const DRD_createPlayerYieldsData = DiploRibbonData.createPlayerYieldsData;
DiploRibbonData.createPlayerYieldsData = function(player, isLocal) {
    const round = (y) =>
        Locale.compose(
            "LOC_BZ_GROUPED_MODIFIER",
            y < 100 ? Math.trunc(y * 10) / 10 : Math.trunc(y)
        );
    // count combat strength (best of melee, ranged, bombard)
    const combat = (unit) => {
        if (!unit.Combat?.canAttack) return 0;
        return Math.max(
            unit.Combat.getMeleeStrength(false),
            unit.Combat.rangedStrength,
            unit.Combat.bombardStrength,
        );
    }
    const yieldCombat = player.Units.getUnits()
        .map(unit => combat(unit)).reduce((a, c) => a + c, 0);
    // count food (in growing settlements only)
    const cities = player.Cities.getCities();
    const yieldFood = cities.filter(city => city.Growth.growthType == GrowthTypes.EXPAND)
        .map(city => city.Yields.getNetYield(YieldTypes.YIELD_FOOD))
        .reduce((a, c) => a + c, 0) ?? 0;
    // count production (in cities only)
    const yieldProduction = cities.filter(city => !city.isTown)
        .map(city => city.Yields.getNetYield(YieldTypes.YIELD_PRODUCTION))
        .reduce((a, c) => a + c, 0) ?? 0;
    // adjust vanilla format
    const ydata = DRD_createPlayerYieldsData.call(this, player, isLocal);
    if (!ydata?.length) return ydata;  // diplomacy dialogs don't show yields
    for (const y of ydata) {
        if (y.value.match(/^[-+]\d+$/)) y.value = round(y.rawValue);
    }
    // insert new data
    return [
        {
            type: "combat",
            label: Locale.compose(BZ_YIELD_COMBAT_STRENGTH),
            value: Locale.compose("LOC_BZ_GROUPED_DIGITS", yieldCombat),
            img: this.getImg("NAR_REW_COMBAT", isLocal),
            details: "",
            rawValue: yieldCombat,
            warningThreshold: Infinity
        },
        {
            type: "food",
            label: Locale.compose("LOC_YIELD_FOOD"),
            value: round(yieldFood),
            img: this.getImg("YIELD_FOOD", isLocal),
            details: "",
            rawValue: yieldFood,
            warningThreshold: Infinity
        },
        {
            type: "production",
            label: Locale.compose("LOC_YIELD_PRODUCTION"),
            value: round(yieldProduction),
            img: this.getImg("YIELD_PRODUCTION", isLocal),
            details: "",
            rawValue: yieldProduction,
            warningThreshold: Infinity
        },
        ...ydata
    ];
}
// refresh model with patched version
engine.whenReady.then(() => DiploRibbonData.updateAll());

class bzPanelDiploRibbon {
    static c = null;
    constructor(component) {
        this.component = component;
        this.component.bzCleanSlate = this;
        this.component.Root.classList.add("bz-clean-slate");
        this.patchPrototype(Object.getPrototypeOf(component));
    }
    patchPrototype(proto) {
        if (bzPanelDiploRibbon.c) return;  // one-time initialization
        // patch PanelDiploRibbon methods
        const c = bzPanelDiploRibbon.c = { proto };
        // wrap c.populateFlags to extend it
        c.populateFlags = proto.populateFlags;
        proto.populateFlags = function(...args) {
            const crv = c.populateFlags.apply(this, args);
            const arv = this.bzCleanSlate.afterModelUpdate(...args);
            return arv ?? crv;
        }
        // wrap c.onModelUpdate to extend it
        c.onModelUpdate = proto.onModelUpdate;
        proto.onModelUpdate = function(...args) {
            const crv = c.onModelUpdate.apply(this, args);
            const arv = this.bzCleanSlate.afterModelUpdate(...args);
            return arv ?? crv;
        }
    }
    beforeAttach() { }
    afterAttach() { }
    afterModelUpdate() {
        // calculate minimum & maximum yields for all visible players
        const yrows = [];
        for (const pdata of DiploRibbonData.playerData) {
            for (const [i, y] of pdata.yields.entries()) {
                yrows[i] ??= [];
                yrows[i].push(y.rawValue);
            }
        }
        const minYields = yrows.map(row => Math.min(...row));
        const maxYields = yrows.map(row => Math.max(...row));
        // restyle ribbon yields
        const targetArray =
            InterfaceMode.isInInterfaceMode("INTERFACEMODE_DIPLOMACY_DIALOG") ||
            InterfaceMode.isInInterfaceMode("INTERFACEMODE_CALL_TO_ARMS") ||
            InterfaceMode.isInInterfaceMode("INTERFACEMODE_DIPLOMACY_PROJECT_REACTION") ?
            DiploRibbonData.diploStatementPlayerData :
            DiploRibbonData.playerData;
        const localData = targetArray.find(e => e.id == GameContext.localObserverID);
        const localYields = localData?.yields;
        for (const [i, flag] of this.component.diploRibbons.entries()) {
            const items = [...flag.querySelectorAll(".yield-item")];
            const pdata = targetArray[i];
            // const isLocal = pdata.id == GameContext.localObserverID;
            for (const [j, y] of pdata.yields.entries()) {
                const item = items[j];
                // override other mods
                item.style.backgroundImage = null;
                // adjust font and color
                item.classList.replace("font-title-base", "font-body-sm");
                if (y.rawValue < 0) item.classList.add("text-negative");
                // highlight minimums and maximums
                if (y.type == "trade") {
                    const isMax = y.rawValue && y.warningThreshold <= y.rawValue;
                    item.classList.toggle("bz-yield-max", isMax);
                } else {
                    const isLocalMin = localYields?.[j].rawValue == minYields[j];
                    const showMin = 4 <= targetArray.length + isLocalMin;
                    const isMin = y.rawValue == minYields[j];
                    const isMax = y.rawValue == maxYields[j];
                    if (localYields && 3 <= targetArray.length) {
                        // highlight yields higher than local player
                        const showMore = !showMin || !isLocalMin;
                        const isMore = localYields[j].rawValue < y.rawValue;
                        item.classList.toggle("bz-yield-more", showMore && isMore);
                    }
                    item.classList.toggle("bz-yield-min", showMin && isMin && !isMax);
                    item.classList.toggle("bz-yield-max", isMax && !isMin);
                    const isWarning = y.warningThreshold < y.rawValue;
                    item.classList.toggle("bz-yield-warning", isWarning);
                }
            }
        }
    }
    beforeDetach() { }
    afterDetach() { }
}

// track unit gains and losses
engine.on("UnitAddedToMap", DiploRibbonData.queueUpdate, DiploRibbonData);
engine.on("UnitRemovedFromMap", DiploRibbonData.queueUpdate, DiploRibbonData);

ComponentUtilities.preloadImages(
    "blp:dip_warswordshield",
    "blp:nar_rew_combat",
    "blp:Yield_Food",
    "blp:Yield_Production",
);
Controls.decorate("panel-diplo-ribbon", (c) => new bzPanelDiploRibbon(c));
Controls.loadStyle("fs://game/bz-clean-slate/ui/diplo-ribbon/bz-diplo-ribbon.css");
