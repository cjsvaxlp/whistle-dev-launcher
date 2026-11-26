// 每个项目登录后要返回的页面。值可以是站内路径或完整 URL。
// 同时供 Node 服务端和浏览器注入脚本使用，改这一个文件即可。
// 未配置的项目继续使用原有入口路由。
(function (root) {
  const targets = {
    power: '/cybercafe-power/#/resource/system/server',
    service: '/cybercafe-service/#/project/view/list',
    open: '/cybercafe-open/#/resource/instance',
    client: '/cybercafe-client/#/Home',
    'web-client': '/cybercafe-web-client/#/Home',
    h5: '/cybercafe-h5/#/download',
    game: '/cybercafe-game/#/gameList/menu',
    cms: '/cybercafe-cms/#/businessManagement/product/productList',
    newcms: '/cybercafe-newcms/#/bercafe/product/productlist',
    cloud: '/cybercafe-cloud/#/login',
    external: '/cybercafe-external/#/amsportal',
    hub: '/cybercafe-hub/#/enterprise/manage',
    store: '/cybercafe-store/#/merchant/store/list',
    inter: '/cybercafe-inter/#/noPower',
    monitor: '/cybercafe-monitor/#/noPower',
  };
  root.__cafeLoginTargets = targets;
  if (typeof module !== 'undefined' && module.exports) module.exports = targets;
})(typeof window !== 'undefined' ? window : globalThis);
