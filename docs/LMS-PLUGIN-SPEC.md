# LMS Plugin Specification: Unified Hi-Fi Control

## Overview

This document specifies an LMS (Lyrion Music Server) plugin that manages the Unified Hi-Fi Control bridge as a helper process. The plugin follows the established pattern used by [LMS-Cast](https://github.com/philippe44/LMS-Cast) and similar plugins.

## User Experience

### Installation
1. User navigates to **LMS → Settings → Plugins**
2. Scrolls to **3rd Party Plugins** section
3. Finds "Unified Hi-Fi Control" and clicks install
4. Restarts LMS when prompted
5. Bridge auto-starts with correct binary for their platform

### Configuration
1. After restart, user goes to **Settings → Unified Hi-Fi Control**
2. Sees link to open the bridge's web UI (http://host:8088)
3. Can configure:
   - Auto-start on/off
   - Port number (default 8088)
   - Binary selection (if multiple available)
   - Log level

### Runtime
- Bridge starts automatically when LMS starts (if autorun enabled)
- Health monitoring restarts bridge if it crashes
- Clean shutdown when LMS stops

---

## Plugin Structure

```
lms-unified-hifi-control/
├── Plugin.pm                      # Main plugin entry point
├── Helper.pm                      # Binary lifecycle management
├── Settings.pm                    # Web UI settings page
├── install.xml                    # Plugin metadata
├── repo.xml                       # Repository definition (for distribution)
├── strings.txt                    # Localization strings
├── HTML/
│   └── EN/
│       └── plugins/
│           └── UnifiedHiFi/
│               └── settings/
│                   └── basic.html # Settings page template
└── Bin/
    ├── unified-hifi-linux-x86_64
    ├── unified-hifi-linux-x86_64-static
    ├── unified-hifi-linux-aarch64
    ├── unified-hifi-linux-armv7l
    ├── unified-hifi-darwin-x86_64
    ├── unified-hifi-darwin-arm64
    └── unified-hifi-win64.exe
```

---

## File Specifications

### install.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<extensions>
  <plugin name="PLUGIN_UNIFIED_HIFI"
          version="1.0.0"
          module="Plugins::UnifiedHiFi::Plugin"
          enabled="1">
    <creator>Your Name</creator>
    <email>your@email.com</email>
    <version>1.0.0</version>
    <minTarget>8.0</minTarget>
    <maxTarget>*</maxTarget>
    <name>PLUGIN_UNIFIED_HIFI</name>
    <title lang="EN">Unified Hi-Fi Control</title>
    <desc lang="EN">Source-agnostic hi-fi control bridge for Roon, LMS, HQPlayer, and hardware knobs.</desc>
    <settings>plugins/UnifiedHiFi/settings/basic.html</settings>
  </plugin>
</extensions>
```

### strings.txt

```
PLUGIN_UNIFIED_HIFI
	EN	Unified Hi-Fi Control

PLUGIN_UNIFIED_HIFI_DESC
	EN	Source-agnostic hi-fi control bridge for Roon, LMS, HQPlayer, and hardware knobs. Provides HTTP APIs, MQTT integration, and web UI.

PLUGIN_UNIFIED_HIFI_AUTORUN
	EN	Auto-start bridge

PLUGIN_UNIFIED_HIFI_AUTORUN_DESC
	EN	Automatically start the Unified Hi-Fi Control bridge when LMS starts.

PLUGIN_UNIFIED_HIFI_PORT
	EN	Bridge port

PLUGIN_UNIFIED_HIFI_PORT_DESC
	EN	HTTP port for the bridge web UI and API (default: 8088). Change if conflicting with HQPlayer.

PLUGIN_UNIFIED_HIFI_BINARY
	EN	Binary

PLUGIN_UNIFIED_HIFI_BINARY_DESC
	EN	Select which binary to use. Use static version if you have library compatibility issues.

PLUGIN_UNIFIED_HIFI_RUNNING
	EN	Running

PLUGIN_UNIFIED_HIFI_STOPPED
	EN	Stopped

PLUGIN_UNIFIED_HIFI_OPENUI
	EN	Open Web UI

PLUGIN_UNIFIED_HIFI_LOGLEVEL
	EN	Log level

PLUGIN_UNIFIED_HIFI_LOGLEVEL_DESC
	EN	Set the logging verbosity for troubleshooting.
```

### Plugin.pm

```perl
package Plugins::UnifiedHiFi::Plugin;

use strict;
use warnings;

use base qw(Slim::Plugin::Base);

use Slim::Utils::Prefs;
use Slim::Utils::Log;
use Slim::Utils::Strings qw(string);

use Plugins::UnifiedHiFi::Helper;

my $log = Slim::Utils::Log->addLogCategory({
    'category'     => 'plugin.unifiedhifi',
    'defaultLevel' => 'WARN',
    'description'  => 'PLUGIN_UNIFIED_HIFI',
});

my $prefs = preferences('plugin.unifiedhifi');

# Default preferences
$prefs->init({
    autorun  => 1,
    port     => 8088,
    bin      => undef,
    loglevel => 'info',
});

sub initPlugin {
    my $class = shift;

    $class->SUPER::initPlugin(@_);

    require Plugins::UnifiedHiFi::Settings;
    Plugins::UnifiedHiFi::Settings->new;

    # Start the helper if autorun is enabled
    if ($prefs->get('autorun')) {
        Plugins::UnifiedHiFi::Helper->start;
    }

    $log->info("Unified Hi-Fi Control plugin initialized");
}

sub shutdownPlugin {
    Plugins::UnifiedHiFi::Helper->stop;
    $log->info("Unified Hi-Fi Control plugin shutdown");
}

sub getDisplayName {
    return 'PLUGIN_UNIFIED_HIFI';
}

sub playerMenu { }

1;
```

### Helper.pm

```perl
package Plugins::UnifiedHiFi::Helper;

use strict;
use warnings;

use File::Spec::Functions qw(catfile catdir);
use File::Which qw(which);
use Proc::Background;

use Slim::Utils::Log;
use Slim::Utils::Prefs;
use Slim::Utils::OSDetect;
use Slim::Utils::Misc;
use Slim::Utils::Timers;

my $log = logger('plugin.unifiedhifi');
my $prefs = preferences('plugin.unifiedhifi');

my $helper;       # Proc::Background instance
my $binary;       # Path to selected binary
my $restarts = 0; # Restart counter

use constant HEALTH_CHECK_INTERVAL => 30;  # seconds
use constant MAX_RESTARTS          => 5;   # before giving up
use constant RESTART_RESET_TIME    => 300; # reset counter after 5 min stable

# Detect OS and return available binaries
sub binaries {
    my $os = Slim::Utils::OSDetect::OS();
    my $details = Slim::Utils::OSDetect::details();
    my $arch = $details->{'osArch'} || $details->{'binArch'} || 'x86_64';

    my $bindir = catdir(__PACKAGE__->_pluginDataFor('basedir'), 'Bin');
    my @binaries;

    if ($os eq 'win') {
        push @binaries, 'unified-hifi-win64.exe';
    }
    elsif ($os eq 'mac') {
        if ($arch =~ /arm|aarch64/i) {
            push @binaries, 'unified-hifi-darwin-arm64';
        } else {
            push @binaries, 'unified-hifi-darwin-x86_64';
        }
    }
    else {
        # Linux and other Unix-like systems
        if ($arch =~ /x86_64|amd64/i) {
            push @binaries, 'unified-hifi-linux-x86_64';
            push @binaries, 'unified-hifi-linux-x86_64-static';
        }
        elsif ($arch =~ /aarch64|arm64/i) {
            push @binaries, 'unified-hifi-linux-aarch64';
        }
        elsif ($arch =~ /arm/i) {
            push @binaries, 'unified-hifi-linux-armv7l';
        }
    }

    # Filter to only existing files
    my @available;
    for my $bin (@binaries) {
        my $path = catfile($bindir, $bin);
        push @available, $bin if -e $path;
    }

    $log->debug("Available binaries for $os/$arch: " . join(', ', @available));
    return @available;
}

# Get path to the selected binary
sub bin {
    my $class = shift;

    my $bindir = catdir(__PACKAGE__->_pluginDataFor('basedir'), 'Bin');
    my @available = $class->binaries();

    return unless @available;

    # Use preference or default to first available
    my $selected = $prefs->get('bin') || $available[0];

    # Validate selection
    unless (grep { $_ eq $selected } @available) {
        $selected = $available[0];
        $prefs->set('bin', $selected);
    }

    return catfile($bindir, $selected);
}

# Start the helper process
sub start {
    my $class = shift;

    return if $helper && $helper->alive;

    $binary = $class->bin();
    unless ($binary && -e $binary) {
        $log->error("No suitable binary found for this platform");
        return;
    }

    my $port = $prefs->get('port') || 8088;
    my $loglevel = $prefs->get('loglevel') || 'info';

    # Make executable on Unix
    if (Slim::Utils::OSDetect::OS() ne 'win') {
        chmod 0755, $binary;
    }

    # Build command line
    my @cmd = ($binary);

    # Set environment variables (the Node.js app reads these)
    $ENV{PORT} = $port;
    $ENV{LOG_LEVEL} = $loglevel;
    $ENV{CONFIG_DIR} = Slim::Utils::OSDetect::dirsFor('prefs');

    $log->info("Starting Unified Hi-Fi Control: $binary on port $port");

    eval {
        $helper = Proc::Background->new({'die_upon_destroy' => 1}, @cmd);
    };

    if ($@ || !$helper) {
        $log->error("Failed to start helper: $@");
        return;
    }

    # Schedule health checks
    Slim::Utils::Timers::setTimer($class, time() + HEALTH_CHECK_INTERVAL, \&_healthCheck);

    return 1;
}

# Stop the helper process
sub stop {
    my $class = shift;

    Slim::Utils::Timers::killTimers($class, \&_healthCheck);

    if ($helper && $helper->alive) {
        $log->info("Stopping Unified Hi-Fi Control");
        $helper->die;
        $helper = undef;
    }

    $restarts = 0;
}

# Check if running
sub running {
    return $helper && $helper->alive;
}

# Get the web UI URL
sub webUrl {
    my $class = shift;
    my $port = $prefs->get('port') || 8088;
    return "http://localhost:$port";
}

# Health check timer callback
sub _healthCheck {
    my $class = shift;

    if ($prefs->get('autorun')) {
        if (!$helper || !$helper->alive) {
            $log->warn("Helper process died unexpectedly");

            if ($restarts < MAX_RESTARTS) {
                $restarts++;
                $log->info("Restarting helper (attempt $restarts/" . MAX_RESTARTS . ")");
                $class->start();
            } else {
                $log->error("Max restarts exceeded, giving up");
                return;
            }
        } else {
            # Process is healthy, schedule restart counter reset
            if ($restarts > 0) {
                Slim::Utils::Timers::setTimer(
                    $class,
                    time() + RESTART_RESET_TIME,
                    sub { $restarts = 0; }
                );
            }
        }

        # Schedule next health check
        Slim::Utils::Timers::setTimer(
            $class,
            time() + HEALTH_CHECK_INTERVAL,
            \&_healthCheck
        );
    }
}

sub _pluginDataFor {
    my ($class, $key) = @_;
    return Slim::Utils::PluginManager->dataForPlugin($class)->{$key};
}

1;
```

### Settings.pm

```perl
package Plugins::UnifiedHiFi::Settings;

use strict;
use warnings;

use base qw(Slim::Web::Settings);

use Slim::Utils::Prefs;
use Slim::Utils::Log;
use Slim::Utils::Strings qw(string);

use Plugins::UnifiedHiFi::Helper;

my $log = logger('plugin.unifiedhifi');
my $prefs = preferences('plugin.unifiedhifi');

sub name {
    return 'PLUGIN_UNIFIED_HIFI';
}

sub page {
    return 'plugins/UnifiedHiFi/settings/basic.html';
}

sub prefs {
    return ($prefs, qw(autorun port bin loglevel));
}

sub handler {
    my ($class, $client, $params, $callback, @args) = @_;

    # Handle start/stop actions
    if ($params->{'start'}) {
        Plugins::UnifiedHiFi::Helper->start();
    }
    elsif ($params->{'stop'}) {
        Plugins::UnifiedHiFi::Helper->stop();
    }

    # Save preferences if form submitted
    if ($params->{'saveSettings'}) {
        $prefs->set('autorun',  $params->{'pref_autorun'} ? 1 : 0);
        $prefs->set('port',     $params->{'pref_port'} || 8088);
        $prefs->set('bin',      $params->{'pref_bin'});
        $prefs->set('loglevel', $params->{'pref_loglevel'} || 'info');

        # Restart if running and settings changed
        if (Plugins::UnifiedHiFi::Helper->running()) {
            Plugins::UnifiedHiFi::Helper->stop();
            Plugins::UnifiedHiFi::Helper->start() if $prefs->get('autorun');
        }
    }

    return $class->SUPER::handler($client, $params, $callback, @args);
}

sub beforeRender {
    my ($class, $params, $client) = @_;

    # Add template variables
    $params->{'running'}    = Plugins::UnifiedHiFi::Helper->running();
    $params->{'webUrl'}     = Plugins::UnifiedHiFi::Helper->webUrl();
    $params->{'binaries'}   = [Plugins::UnifiedHiFi::Helper->binaries()];
    $params->{'loglevels'}  = ['error', 'warn', 'info', 'debug'];

    return $class->SUPER::beforeRender($params, $client);
}

1;
```

### HTML/EN/plugins/UnifiedHiFi/settings/basic.html

```html
[% PROCESS settings/header.html %]

<div class="settingGroup">
    <div class="prefHead">
        [% "PLUGIN_UNIFIED_HIFI" | string %]
    </div>

    <!-- Status indicator -->
    <div class="prefDesc">
        <b>[% "Status" | string %]:</b>
        [% IF running %]
            <span style="color: green; font-weight: bold;">
                [% "PLUGIN_UNIFIED_HIFI_RUNNING" | string %]
            </span>
            &nbsp;
            <a href="[% webUrl %]" target="_blank" class="button">
                [% "PLUGIN_UNIFIED_HIFI_OPENUI" | string %] &rarr;
            </a>
        [% ELSE %]
            <span style="color: red; font-weight: bold;">
                [% "PLUGIN_UNIFIED_HIFI_STOPPED" | string %]
            </span>
        [% END %]
    </div>

    <!-- Manual start/stop -->
    <div class="prefDesc" style="margin-top: 10px;">
        [% IF running %]
            <input type="submit" name="stop" value="Stop" class="button" />
        [% ELSE %]
            <input type="submit" name="start" value="Start" class="button" />
        [% END %]
    </div>
</div>

<div class="settingGroup">
    <div class="prefHead">
        [% "PLUGIN_UNIFIED_HIFI_AUTORUN" | string %]
    </div>
    <div class="prefDesc">
        [% "PLUGIN_UNIFIED_HIFI_AUTORUN_DESC" | string %]
    </div>
    <div class="prefValue">
        <input type="checkbox" name="pref_autorun" id="pref_autorun"
               value="1" [% IF prefs.autorun %]checked[% END %] />
    </div>
</div>

<div class="settingGroup">
    <div class="prefHead">
        [% "PLUGIN_UNIFIED_HIFI_PORT" | string %]
    </div>
    <div class="prefDesc">
        [% "PLUGIN_UNIFIED_HIFI_PORT_DESC" | string %]
    </div>
    <div class="prefValue">
        <input type="number" name="pref_port" id="pref_port"
               value="[% prefs.port || 8088 %]" min="1024" max="65535" />
    </div>
</div>

<div class="settingGroup">
    <div class="prefHead">
        [% "PLUGIN_UNIFIED_HIFI_BINARY" | string %]
    </div>
    <div class="prefDesc">
        [% "PLUGIN_UNIFIED_HIFI_BINARY_DESC" | string %]
    </div>
    <div class="prefValue">
        <select name="pref_bin" id="pref_bin">
            [% FOREACH bin IN binaries %]
                <option value="[% bin %]"
                        [% IF prefs.bin == bin %]selected[% END %]>
                    [% bin %]
                </option>
            [% END %]
        </select>
    </div>
</div>

<div class="settingGroup">
    <div class="prefHead">
        [% "PLUGIN_UNIFIED_HIFI_LOGLEVEL" | string %]
    </div>
    <div class="prefDesc">
        [% "PLUGIN_UNIFIED_HIFI_LOGLEVEL_DESC" | string %]
    </div>
    <div class="prefValue">
        <select name="pref_loglevel" id="pref_loglevel">
            [% FOREACH level IN loglevels %]
                <option value="[% level %]"
                        [% IF prefs.loglevel == level %]selected[% END %]>
                    [% level %]
                </option>
            [% END %]
        </select>
    </div>
</div>

[% PROCESS settings/footer.html %]
```

### repo.xml (for distribution)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<extensions>
  <plugins>
    <plugin name="UnifiedHiFi"
            version="1.0.0"
            minTarget="8.0"
            maxTarget="*">
      <title lang="EN">Unified Hi-Fi Control</title>
      <desc lang="EN">Source-agnostic hi-fi control bridge for Roon, LMS, HQPlayer, and hardware knobs. Provides HTTP APIs, MQTT integration, and web UI for controlling your audio system from anywhere.</desc>
      <url>https://github.com/muness/unified-hifi-control/releases/download/v1.0.0/lms-unified-hifi-control-1.0.0.zip</url>
      <sha>SHA1_CHECKSUM_HERE</sha>
      <creator>Muness Alrubaie</creator>
      <email>muness@alrubaie.net</email>
    </plugin>
  </plugins>
</extensions>
```

---

## Binary Build Requirements

The plugin requires pre-built binaries for each supported platform. These are created using [pkg](https://github.com/vercel/pkg):

### Target Platforms

| Platform | Architecture | Binary Name | Notes |
|----------|--------------|-------------|-------|
| Linux | x86_64 | unified-hifi-linux-x86_64 | Most NAS, standard PCs |
| Linux | x86_64 | unified-hifi-linux-x86_64-static | Static linked for older systems |
| Linux | aarch64 | unified-hifi-linux-aarch64 | Raspberry Pi 4/5, ARM servers |
| Linux | armv7l | unified-hifi-linux-armv7l | Raspberry Pi 3, older ARM |
| macOS | x86_64 | unified-hifi-darwin-x86_64 | Intel Macs |
| macOS | arm64 | unified-hifi-darwin-arm64 | Apple Silicon |
| Windows | x64 | unified-hifi-win64.exe | Windows 10/11 |

### pkg Configuration (add to package.json)

```json
{
  "pkg": {
    "scripts": ["src/**/*.js"],
    "assets": ["src/ui/**/*"],
    "targets": [
      "node18-linux-x64",
      "node18-linux-arm64",
      "node18-macos-x64",
      "node18-macos-arm64",
      "node18-win-x64"
    ],
    "outputPath": "dist"
  }
}
```

---

## Distribution Workflow

### Initial Setup

1. Add repo.xml URL to [LMS-Community/lms-plugin-repository](https://github.com/LMS-Community/lms-plugin-repository)
2. Submit PR to include in official 3rd party plugins list

### Release Process

1. Build binaries for all platforms
2. Package plugin directory into zip
3. Generate SHA1 checksum: `sha1sum lms-unified-hifi-control-X.X.X.zip`
4. Update repo.xml with new version, URL, and SHA
5. Create GitHub release with zip attached
6. Users receive update notification in LMS

### CI/CD Integration

```yaml
# .github/workflows/release-lms-plugin.yml
name: Build LMS Plugin

on:
  release:
    types: [published]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build binaries
        run: npm run build:binaries

      - name: Package LMS plugin
        run: npm run build:lms-plugin

      - name: Upload to release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/lms-unified-hifi-control-*.zip
```

---

## Configuration Passthrough

The plugin passes configuration to the Node.js binary via environment variables:

| Env Variable | Source | Description |
|--------------|--------|-------------|
| PORT | Plugin pref | HTTP server port |
| CONFIG_DIR | LMS prefs dir | Where to store app-settings.json |
| LOG_LEVEL | Plugin pref | Logging verbosity |

Additional environment variables (LMS_HOST, MQTT_*, HQP_*) can be set system-wide or added to future plugin settings.

---

## Testing Checklist

- [ ] Plugin installs via zip file
- [ ] Correct binary selected for platform
- [ ] Binary starts on LMS startup (autorun enabled)
- [ ] Binary stops on LMS shutdown
- [ ] Web UI link works from settings page
- [ ] Start/Stop buttons work
- [ ] Port change takes effect after restart
- [ ] Health check restarts crashed binary
- [ ] Max restart limit prevents infinite loops
- [ ] Settings persist across LMS restarts
- [ ] Works on: Linux x64, Linux ARM, macOS Intel, macOS ARM, Windows

---

## Future Enhancements

1. **Embedded Config UI**: Proxy the bridge's /admin page within LMS settings
2. **Player Linking**: Auto-detect LMS players and configure them in the bridge
3. **Status Display**: Show now-playing info from Roon/HQPlayer in LMS interface
4. **Log Viewer**: Display bridge logs within LMS settings page
