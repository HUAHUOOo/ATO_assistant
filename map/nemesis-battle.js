(function () {
  const optionsByCycle = {
    c1: ["pursuer"],
    c2: ["adversary", "pursuer", "dahaka"],
    c3: ["adversary", "dahaka"],
    c4: ["dahaka"],
    c5: ["titanX"],
  };
  const battleCycleByNemesis = {
    pursuer: "c1",
    adversary: "c2",
    dahaka: "c4",
    titanX: "c5",
  };

  function targetFor(cycleId, record, defaultTargets) {
    const options = optionsByCycle[cycleId];
    if (!options) return null;
    const selected = record?.nemesisSelections?.[cycleId];
    const nemesis = options.includes(selected) ? selected : options[0];
    return defaultTargets[battleCycleByNemesis[nemesis]] || null;
  }

  window.ATO_NEMESIS_BATTLE = { targetFor };
})();
