package Plugins::UnifiedHiFi::Settings;

# Settings page for Unified Hi-Fi Control plugin

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
    return ($prefs, qw(autorun port));
}

sub handler {
    my ($class, $client, $params) = @_;

    # Handle start/stop actions
    if ($params->{'start'}) {
        Plugins::UnifiedHiFi::Helper->start();
    }
    elsif ($params->{'stop'}) {
        Plugins::UnifiedHiFi::Helper->stop();
    }

    # Check if we need to restart the helper after saving settings
    my $needsRestart = 0;
    if ($params->{'saveSettings'}) {
        if (($params->{'pref_port'} // 8088) != ($prefs->get('port') // 8088)) {
            $needsRestart = 1;
        }

        # Restart if running and settings changed
        if ($needsRestart && Plugins::UnifiedHiFi::Helper->running()) {
            $params->{needsRestart} = 1;
        }
    }

    # Knob status will be fetched via JavaScript on the page if needed
    $params->{'knobStatus'} = { knobs => [] };

    return $class->SUPER::handler($client, $params);
}

sub beforeRender {
    my ($class, $params, $client) = @_;

    if ( $params->{saveSettings} && $params->{needsRestart} ) {
        $log->info("Settings changed, restarting helper");
        Plugins::UnifiedHiFi::Helper->stop();
        # Always attempt start after stop to ensure service is running
        # Small delay to allow process to fully terminate
        Slim::Utils::Timers::setTimer(undef, time() + 1, sub {
            Plugins::UnifiedHiFi::Helper->start();
        });
    }

    # Add template variables (wrapped in eval for safety)
    $params->{'running'}      = eval { Plugins::UnifiedHiFi::Helper->running() } || 0;
    $params->{'webUrl'}       = eval { Plugins::UnifiedHiFi::Helper->webUrl() } || '';
    $params->{'binaryStatus'} = eval { Plugins::UnifiedHiFi::Helper->binaryStatus() } || 'unknown';

    $log->error("Error in beforeRender: $@") if $@;

    return $class->SUPER::beforeRender($params, $client);
}

1;

__END__

=head1 NAME

Plugins::UnifiedHiFi::Settings - Web UI settings page

=head1 DESCRIPTION

Provides the settings interface for configuring the Unified Hi-Fi Control plugin.

=cut
