// 云函数调用封装：统一错误处理 + 约定返回 { ok:true, ... } / { ok:false, error, code }
function call(name, data) {
  return wx.cloud.callFunction({ name, data: data || {} }).then((r) => {
    const res = (r && r.result) || {};
    if (res.ok === false) {
      const err = new Error(res.error || '请求失败');
      err.code = res.code;
      err.payload = res;
      throw err;
    }
    return res;
  });
}

module.exports = { call };
