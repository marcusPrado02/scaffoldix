/**
 * Shell completion command.
 *
 * Generates shell completion scripts for bash, zsh, and fish so users
 * can get tab-completion for all scaffoldix commands and options.
 *
 * Usage:
 *   scaffoldix completion bash >> ~/.bashrc
 *   scaffoldix completion zsh  >> ~/.zshrc
 *   scaffoldix completion fish > ~/.config/fish/completions/scaffoldix.fish
 *
 * @module
 */

import { Command } from "commander";

const BASH_COMPLETION = `
# scaffoldix bash completion
_scaffoldix_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="generate pack archetypes doctor completion"
  local pack_commands="add list info remove"
  local archetypes_commands="list"
  local global_opts="--verbose --debug --silent --version --help"

  case "\${prev}" in
    scaffoldix)
      COMPREPLY=( $(compgen -W "\${commands} \${global_opts}" -- "\${cur}") )
      return ;;
    pack)
      COMPREPLY=( $(compgen -W "\${pack_commands}" -- "\${cur}") )
      return ;;
    archetypes)
      COMPREPLY=( $(compgen -W "\${archetypes_commands}" -- "\${cur}") )
      return ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return ;;
    add)
      COMPREPLY=( $(compgen -f -- "\${cur}") )
      return ;;
    generate|g)
      COMPREPLY=( $(compgen -W "--target --dry-run --yes --force --verbose" -- "\${cur}") )
      return ;;
    --target)
      COMPREPLY=( $(compgen -d -- "\${cur}") )
      return ;;
  esac

  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
}

complete -F _scaffoldix_completion scaffoldix
`.trimStart();

const ZSH_COMPLETION = `
#compdef scaffoldix

_scaffoldix() {
  local -a commands

  commands=(
    'generate:Generate code from an installed pack archetype'
    'g:Alias for generate'
    'pack:Manage installed packs'
    'archetypes:View available archetypes'
    'doctor:Check Scaffoldix environment and diagnose issues'
    'completion:Generate shell completion scripts'
  )

  local -a global_opts
  global_opts=(
    '--verbose[Show additional context and details]'
    '--debug[Show all output including debug traces]'
    '--silent[Suppress all output except errors]'
    '--version[Print version]'
    '--help[Show help]'
  )

  _arguments -C \\
    '\${global_opts[@]}' \\
    '1: :->command' \\
    '*:: :->args'

  case \$state in
    command)
      _describe 'command' commands ;;
    args)
      case \$words[1] in
        generate|g)
          _arguments \\
            '1:ref:($(scaffoldix archetypes list 2>/dev/null))' \\
            '--target[Target directory]:directory:_files -/' \\
            '--dry-run[Preview only]' \\
            '--yes[Non-interactive]' \\
            '--force[Overwrite existing files]' \\
            '--verbose[Show timing trace]' ;;
        pack)
          local -a pack_cmds
          pack_cmds=(
            'add:Install a local pack into the Store'
            'list:List installed packs'
            'info:Show information about a specific pack'
            'remove:Remove a pack from the Store'
          )
          _arguments '1: :->pack_cmd' '*:: :->pack_args'
          case \$state in
            pack_cmd) _describe 'pack command' pack_cmds ;;
            pack_args)
              case \$words[1] in
                add)  _files -/ ;;
                info|remove) _message 'pack ID' ;;
                list) _arguments '--json[Output as JSON]' ;;
              esac ;;
          esac ;;
        archetypes)
          _arguments '1:(list)' '--json[Output as JSON]' ;;
        completion)
          _arguments '1:(bash zsh fish)' ;;
      esac ;;
  esac
}

_scaffoldix
`.trimStart();

const FISH_COMPLETION = `
# scaffoldix fish completion

# Disable file completion by default
complete -c scaffoldix -f

# Global options
complete -c scaffoldix -l verbose  -d 'Show additional context and details'
complete -c scaffoldix -l debug    -d 'Show all output including debug traces'
complete -c scaffoldix -l silent   -d 'Suppress all output except errors'
complete -c scaffoldix -l version  -d 'Print version'
complete -c scaffoldix -l help     -d 'Show help'

# Top-level commands
complete -c scaffoldix -n '__fish_use_subcommand' -a generate   -d 'Generate code from an installed pack archetype'
complete -c scaffoldix -n '__fish_use_subcommand' -a g          -d 'Alias for generate'
complete -c scaffoldix -n '__fish_use_subcommand' -a pack       -d 'Manage installed packs'
complete -c scaffoldix -n '__fish_use_subcommand' -a archetypes -d 'View available archetypes'
complete -c scaffoldix -n '__fish_use_subcommand' -a doctor     -d 'Check Scaffoldix environment'
complete -c scaffoldix -n '__fish_use_subcommand' -a completion -d 'Generate shell completion scripts'

# completion subcommand
complete -c scaffoldix -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish' -d 'Shell type'

# generate options
complete -c scaffoldix -n '__fish_seen_subcommand_from generate g' -l target   -d 'Target directory' -r -a '(__fish_complete_directories)'
complete -c scaffoldix -n '__fish_seen_subcommand_from generate g' -l dry-run  -d 'Preview only'
complete -c scaffoldix -n '__fish_seen_subcommand_from generate g' -l yes      -d 'Non-interactive mode'
complete -c scaffoldix -n '__fish_seen_subcommand_from generate g' -l force    -d 'Overwrite existing files'
complete -c scaffoldix -n '__fish_seen_subcommand_from generate g' -l verbose  -d 'Show timing trace'

# pack subcommands
complete -c scaffoldix -n '__fish_seen_subcommand_from pack' -a add    -d 'Install a local pack'
complete -c scaffoldix -n '__fish_seen_subcommand_from pack' -a list   -d 'List installed packs'
complete -c scaffoldix -n '__fish_seen_subcommand_from pack' -a info   -d 'Show pack information'
complete -c scaffoldix -n '__fish_seen_subcommand_from pack' -a remove -d 'Remove a pack'

complete -c scaffoldix -n '__fish_seen_subcommand_from pack; and __fish_seen_subcommand_from list' -l json -d 'Output as JSON'
complete -c scaffoldix -n '__fish_seen_subcommand_from pack; and __fish_seen_subcommand_from info' -l json -d 'Output as JSON'

# archetypes subcommands
complete -c scaffoldix -n '__fish_seen_subcommand_from archetypes' -a list -d 'List all archetypes'
complete -c scaffoldix -n '__fish_seen_subcommand_from archetypes; and __fish_seen_subcommand_from list' -l json -d 'Output as JSON'
`.trimStart();

/**
 * Builds the `completion` command.
 *
 * @returns Configured Commander command
 */
export function buildCompletionCommand(): Command {
  return new Command("completion")
    .description("Generate shell completion scripts (bash, zsh, fish)")
    .argument("<shell>", "Shell type: bash | zsh | fish")
    .addHelpText(
      "after",
      `
Examples:
  scaffoldix completion bash >> ~/.bashrc && source ~/.bashrc
  scaffoldix completion zsh  >> ~/.zshrc  && source ~/.zshrc
  scaffoldix completion fish > ~/.config/fish/completions/scaffoldix.fish`,
    )
    .action((shell: string) => {
      const scripts: Record<string, string> = {
        bash: BASH_COMPLETION,
        zsh: ZSH_COMPLETION,
        fish: FISH_COMPLETION,
      };

      const script = scripts[shell.toLowerCase()];
      if (!script) {
        process.stderr.write(
          `Error: unsupported shell "${shell}". Supported shells: bash, zsh, fish\n`,
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(script);
    });
}
