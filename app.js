var express = require("express");
var app = express();
var http = require("http");
const jwt = require("jsonwebtoken"); // 首先确保安装了jsonwebtoken库


//环境变量
require("dotenv").config();
// 日志部分
var winston = require("winston");
var morganlogger = require("morgan");
const { WinstonTransport: AxiomTransport } = require("@axiomhq/axiom-node");
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ message }) => {
      return `${message}`;
    })
  ),
  defaultMeta: { service: "ourworld-service" },
  transports: [
    process.env.AXIOM_TOKEN
      ? new AxiomTransport({
          dataset: process.env.AXIOM_DATASET,
          token: process.env.AXIOM_TOKEN,
        })
      : null,
    new winston.transports.Console(),
  ],
});

// 创建自定义Stream，将日志写入Winston
const winstonStream = {
  write: (message) => {
    logger.info(message.trim());
  },
};
morganlogger.token("colored-status", (req, res) => {
  const status = res.statusCode;
  let color;
  if (status >= 500) {
    color = "\x1b[31m"; // 红色
  } else if (status >= 400) {
    color = "\x1b[33m"; // 黄色
  } else if (status >= 300) {
    color = "\x1b[36m"; // 青色
  } else {
    color = "\x1b[32m"; // 绿色
  }
  return color + status + "\x1b[0m"; // 重置颜色
});
app.use(
  morganlogger(":method :colored-status :response-time ms :remote-addr :url", {
    stream: winstonStream,
  })
);
//console.clog = console.log;
console.log = function (str) {
  logger.info(str);
  //console.clog(str);
};
console.error = function (str) {
  logger.error(str);
  //console.clog(str);
};

// cors配置
var cors = require("cors");
var corsOptions = {
  origin: process.env.corslist,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
};
app.use(cors(corsOptions)); // 应用CORS配置函数

//设置环境变量
//var session = require("express-session"); app.use( session({ secret: process.env.SessionSecret, resave: false, name: "OurWorld-session", saveUninitialized: true, cookie: { secure: false }, }) );
//express 的cookie的解析组件
var cookieParser = require("cookie-parser");
app.use(cookieParser(process.env.SessionSecret));

//express 的http请求体进行解析组件
var bodyParser = require("body-parser");
app.use(bodyParser["urlencoded"]({ limit: "50mb", extended: false }));
app.use(bodyParser["json"]({ limit: "50mb" }));

//文件上传模块
var multipart = require("connect-multiparty");
app.use(multipart({ uploadDir: "./data/upload_tmp" }));

//压缩组件，需要位于 express.static 前面，否则不起作用
var compress = require("compression");
app.use(compress());

app.set("views", __dirname + "/");
app.set("view engine", "views");

//数据库
var DB = require("./server/lib/database.js");

//设置静态资源路径
if (process.env.localstatic == "true") {
  app.use(process.env.staticurl, express.static(process.env.staticpath));
}
//全局变量
global.dirname = __dirname;

//启动http(80端口)==================================
http.createServer(app).listen(3000, "0.0.0.0", function () {
  console.log("Listening on http://localhost:3000");
}); // 平台总入口

const { spawn } = require('child_process');
const cloudflared = spawn('./cloudflared-file/cloudflared', ['tunnel', 'run', '--token', process.env.cloudflared])

cloudflared.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});

cloudflared.stderr.on('data', (data) => {
  console.log(`stderr: ${data}`);
});

cloudflared.on('close', (code) => {
  console.log(`child process exited with code ${code}`);
});
app.all("*", function (req, res, next) {
  //console.log(req.method +' '+ req.url + " IP:" + req.ip);

  const token = req.cookies.token || req.body.token || req.headers["token"]; // 获取JWT令牌

  if (token) {
    jwt.verify(token, process.env.jwttoken, (err, decodedToken) => {
      // 解析并验证JWT
      if (err) {6
        // 如果验证失败，清除本地登录状态
        res.locals = {
          login: false,
          userid: "",
          username: "",
          nickname: "",
          is_admin: 0,
        };
        //console.log("JWT验证失败: " + err.message);
      } else {
        // 如果验证成功，将用户信息存储在res.locals和session中
        let userInfo = decodedToken;
        res.locals.userid = userInfo.userid;
        res.locals.username = userInfo.username;
        res.locals.nickname = userInfo.nickname;
        res.locals["is_admin"] = 0;
        if (userInfo.username == process.env.adminuser) {
          res.locals["is_admin"] = 1;
        }
        //console.log("JWT验证成功: " + userInfo.username);
        //console.log('调试用户信息(session)：'+res.locals.userid+','+res.locals.username+','+res.locals.nickname+','+res.locals.is_admin);


        res.locals = {
          login: true,
          userid: res.locals.userid,
          username: res.locals.username,
          nickname: res.locals.nickname,
          is_admin: res.locals["is_admin"],
        };

        //console.log('调试用户信息(locals )：'+res.locals.userid+','+res.locals.username+','+res.locals.nickname+','+res.locals.is_admin);

      }

      next();
    });
  } else {
    // 如果未找到token，则清除本地登录状态
    res.locals = {
      login: false,
      userid: "",
      username: "",
      nickname: "",
      is_admin: 0,
    };
    console.log("未找到JWT Token");
    next();
  }
});

// 辅助函数：从请求头或请求体中获取JWT Token
function getTokenFromRequest(req) {
  if (req.headers.token && req.headers.token) {
    return req.headers.token.split(" ")[1];
  } else if (req.body && req.body.token) {
    return req.body.token;
  } else if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}
//首页
app.get("/", function (req, res) {
  //获取已分享的作品总数：1:普通作品，2：推荐的优秀作品
  var SQL =
    `SELECT ` +
    ` (SELECT count(id) FROM scratch WHERE state>0 ) AS scratch_count, ` +
    ` (SELECT count(id) FROM python WHERE state>0 ) AS python_count `;
  DB.query(SQL, function (err, data) {
    if (err) {
      // console.error('数据库操作出错：');
      res.locals.scratch_count = 0;
      res.locals.python_count = 0;
    } else {
      res.locals.scratch_count = data[0].scratch_count;
      res.locals.python_count = data[0].python_count;
    }

    // 获取首页头图
    //SQL = `SELECT id, content FROM ads WHERE state=1 ORDER BY i ASC`;
    //DB.query(SQL, function (err, ADS) {
    //  if (err) {
    //    console.error(err);
    //    ADS = [];
    //  }

    //  res.locals["ads"] = encodeURIComponent(JSON.stringify(ADS));

    //});
    res.render("views/index.ejs");
  });
});

//放在最后，确保路由时能先执行app.all=====================
//注册、登录等功能路由
var router_register = require("./server/router_user.js");
app.use("/user", router_register);

//个人中心路由//学生平台路由
var router_admin = require("./server/router_my.js");
app.use("/my", router_admin);

//系统平台路由
var router_admin = require("./server/router_admin.js");
app.use("/admin", router_admin);

//scratch路由
var router_scratch = require("./server/router_scratch.js");
app.use("/scratch", router_scratch);
//api路由
var apiserver = require("./server/router_api.js");
app.use("/api", apiserver);

app.get("/about", function (req, res, next) {
  res.render("views/about.ejs");
});
app.get("/comparer", function (req, res, next) {
  res.render("views/comparer.ejs");
});
app.get("/asdm", function (req, res, next) {
  res.render("views/asdm.ejs");
});
app.get("/share", function (req, res, next) {
  res.render("views/share.ejs");
});
app.get("/home", function (req, res, next) {
  res.render("views/home.ejs");
});
//python路由
var router_python = require("./server/router_python.js");
app.use("/python", router_python);

//头图系统
var router_ads = require("./server/router_ads.js");
app.use("/ads", router_ads);

process.on("uncaughtException", function (err) {
  console.log("Caught exception: " + err);
});

//放在最后，友好的处理地址不存在的访问
app.all("*", function (req, res, next) {
  res.locals.tipType = "访问错误";
  res.render("views/404.ejs");
});
