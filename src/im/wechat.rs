//! 微信平台模块（基于 iLink Bot API / ClawBot 协议）
//!
//! 参考 [wechat-acp](https://github.com/formulahendry/wechat-acp) 的 iLink 协议实现，
//! 将微信消息接入 acp-link 的 [`IMChannel`](crate::im::IMChannel) 统一抽象层。
//!
//! ## 模块结构
//!
//! - [`channel`] — [`WechatChannel`]：实现 `IMChannel` trait
//! - [`client`] — `WechatClient`：iLink HTTP API、long-poll 消息轮询、CDN 媒体加解密

mod channel;
mod client;

pub use self::channel::WechatChannel;
