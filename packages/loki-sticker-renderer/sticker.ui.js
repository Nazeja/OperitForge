function Screen(ctx) {
  const UI = ctx.UI;
  const nameState = ctx.useState ? ctx.useState("name", "sticker") : ["sticker", function () {}];
  const uriState = ctx.useState ? ctx.useState("uri", "") : [""]; 
  const fileUriState = ctx.useState ? ctx.useState("fileUri", "") : [""]; 
  const pathState = ctx.useState ? ctx.useState("path", "") : [""]; 

  const name = String(nameState[0] || "sticker");
  const uri = String(fileUriState[0] || uriState[0] || pathState[0] || "");

  if (!uri) {
    return UI.Text({ text: `[sticker:${name} 路径为空]`, fontSize: 12 });
  }

  return UI.Box({
    width: 120,
    height: 120,
    contentAlignment: "center",
    padding: 2
  }, UI.Image({
    fileUri: uri,
    uri: uri,
    src: uri,
    path: String(pathState[0] || ""),
    contentDescription: name,
    contentScale: "fit",
    width: 120,
    height: 120
  }));
}

exports.default = Screen;
exports.Screen = Screen;