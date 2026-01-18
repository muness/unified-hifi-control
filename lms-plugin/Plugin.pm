package Plugins::UnifiedHiFi::Plugin;

# Unified Hi-Fi Control - LMS Plugin
# Manages the unified-hifi-control bridge as a helper process
# and pushes player state changes via HTTP callbacks (#77)

use strict;
use warnings;

use base qw(Slim::Plugin::Base);

use Slim::Utils::Prefs;
use Slim::Utils::Log;
use Slim::Utils::Strings qw(string);
use Slim::Control::Request;
use Slim::Networking::SimpleAsyncHTTP;
use JSON::XS;

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

    $prefs->setValidate({ 'validator' => 'intlimit', 'low' => 1024, 'high' => 65535 }, 'port');

    # Subscribe to player events for push-based updates (#77)
    # This reduces CPU usage by avoiding constant polling
    Slim::Control::Request->subscribe(\&_playerNotify, [
        ['playlist'],      # Track changes, play/pause/stop
        ['mixer'],         # Volume changes
        ['power'],         # Power on/off
        ['client'],        # Player connect/disconnect
    ]);

    $log->info("Unified Hi-Fi Control plugin initialized (with event subscriptions)");
}

sub shutdownPlugin {
    # Unsubscribe from player events
    Slim::Control::Request->unsubscribe(\&_playerNotify);

    Plugins::UnifiedHiFi::Helper->stop;
    $log->info("Unified Hi-Fi Control plugin shutdown");
}

sub getDisplayName {
    return 'PLUGIN_UNIFIED_HIFI';
}

sub playerMenu { }

# Handle player state change notifications and push to bridge
sub _playerNotify {
    my $request = shift;
    my $client  = $request->client() || return;

    # Don't notify if helper isn't running
    return unless Plugins::UnifiedHiFi::Helper->running();

    my $playerId = $client->id();
    my $command  = $request->getRequestString();

    main::DEBUGLOG && $log->is_debug && $log->debug("Player event: $playerId -> $command");

    # Build notification payload
    my $state = _getPlayerState($client);
    my $volume = $client->volume() // 50;

    # Get now playing info
    my $song = Slim::Player::Playlist::song($client);
    my ($title, $artist, $album, $duration) = ('', '', '', 0);

    if ($song) {
        $title    = $song->title // '';
        $artist   = $song->artistName // '';
        $album    = $song->album ? $song->album->name : '';
        $duration = $song->duration // 0;
    }

    # Get current position
    my $position = Slim::Player::Source::songTime($client) // 0;

    my $payload = {
        player_id => $playerId,
        state     => $state,
        volume    => int($volume),
        title     => $title,
        artist    => $artist,
        album     => $album,
        position  => $position,
        duration  => $duration,
    };

    # POST to bridge
    _notifyBridge($payload);
}

# Get player state string from client
sub _getPlayerState {
    my $client = shift;

    return 'stop' unless $client->power();

    my $mode = Slim::Player::Source::playmode($client) // 'stop';

    return 'play'  if $mode eq 'play';
    return 'pause' if $mode eq 'pause';
    return 'stop';
}

# Send notification to bridge via HTTP POST
sub _notifyBridge {
    my $payload = shift;

    my $port = $prefs->get('port') || 8088;
    my $url  = "http://localhost:$port/api/lms/notify";

    my $json = encode_json($payload);

    main::DEBUGLOG && $log->is_debug && $log->debug("Notifying bridge: $json");

    Slim::Networking::SimpleAsyncHTTP->new(
        sub {
            my $response = shift;
            if ($response->code != 200) {
                $log->warn("Bridge notification failed: " . $response->code);
            }
        },
        sub {
            my ($response, $error) = @_;
            # Don't log errors during normal operation - bridge may not be ready
            main::DEBUGLOG && $log->is_debug && $log->debug("Bridge notification error: $error");
        },
        {
            timeout => 2,
        }
    )->post($url, 'Content-Type' => 'application/json', $json);
}

1;

__END__

=head1 NAME

Plugins::UnifiedHiFi::Plugin - LMS plugin for Unified Hi-Fi Control bridge

=head1 DESCRIPTION

This plugin manages the Unified Hi-Fi Control bridge as a helper process,
providing a unified control layer for Roon, LMS, HQPlayer, and hardware
control surfaces.

=head1 SEE ALSO

L<https://github.com/cloud-atlas-ai/unified-hifi-control>

=cut
