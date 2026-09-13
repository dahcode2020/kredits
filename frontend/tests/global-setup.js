// Le fuseau du CI ne doit pas décider du résultat des formatteurs de dates
// (ils forcent Europe/Brussels; ce réglage rend tout écart résiduel visible et reproductible).
process.env.TZ = 'Europe/Brussels';
module.exports = async () => {};
