use anyhow::{Result, bail};

#[derive(Clone, Copy)]
pub(super) enum Arity {
    Flag,
    Value,
    Values,
    // Optional values must use `=`, so a following word cannot hide a subcommand.
    OptionalInline,
}

pub(super) struct Rules {
    pub name: &'static str,
    pub options: &'static [(&'static str, Arity)],
    pub reserved: &'static [&'static str],
    // Pi uses exact token matching, unlike clap/commander/yargs.
    pub attached_values: bool,
}

impl Rules {
    /// Consume option values before checking for positionals. Never infer the arity
    /// of an unknown option: doing so could swallow a subcommand or an owned flag.
    pub fn validate(&self, args: &[String]) -> Result<()> {
        let mut index = 0;
        while index < args.len() {
            let token = &args[index];
            if token == "--" {
                bail!(
                    "{}: -- is managed by Treefold; configure options only",
                    self.name
                );
            }
            if !token.starts_with('-') || token == "-" {
                bail!(
                    "{}: subcommands and positional arguments are not allowed in the launch command; Treefold manages the directory, initial prompt, and Session resume",
                    self.name
                );
            }
            let (mut flag, mut inline) = token
                .split_once('=')
                .map_or((token.as_str(), None), |(flag, value)| (flag, Some(value)));
            if self.reserved.contains(&flag) {
                bail!(
                    "{} argument {flag} is managed by Treefold or incompatible with an interactive Session",
                    self.name
                );
            }
            let mut arity = self
                .options
                .iter()
                .find(|(name, _)| *name == flag)
                .map(|(_, arity)| *arity);
            // Only recognized short value options accept attached values. Clusters
            // are intentionally rejected instead of guessing how a CLI splits them.
            if arity.is_none()
                && !token.starts_with("--")
                && token.len() > 2
                && token.as_bytes()[1].is_ascii_alphabetic()
            {
                let short = &token[..2];
                if self.reserved.contains(&short) {
                    bail!(
                        "{} argument {short} is managed by Treefold or incompatible with an interactive Session",
                        self.name
                    );
                }
                if self.attached_values {
                    if let Some((_, Arity::Value)) =
                        self.options.iter().find(|(name, _)| *name == short)
                    {
                        flag = short;
                        inline = Some(token[2..].strip_prefix('=').unwrap_or(&token[2..]));
                        arity = Some(Arity::Value);
                    }
                }
            }
            let Some(arity) = arity else {
                bail!(
                    "{}: option {flag} is not supported by Treefold's launch command validator; remove it or update Treefold",
                    self.name
                );
            };
            if inline.is_some() && !self.attached_values {
                bail!("{}: use {flag} followed by a separate value", self.name);
            }
            index += 1;
            match arity {
                Arity::Flag => {
                    if inline.is_some() {
                        bail!("{}: {flag} does not take a value", self.name);
                    }
                }
                Arity::OptionalInline => {}
                Arity::Value | Arity::Values => {
                    if inline.is_none() {
                        if args.get(index).is_none_or(|value| value.starts_with('-')) {
                            bail!(
                                "{}: {flag} requires a value before the next option",
                                self.name
                            );
                        }
                        index += 1;
                    }
                    if matches!(arity, Arity::Values) {
                        while args.get(index).is_some_and(|value| !value.starts_with('-')) {
                            index += 1;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
